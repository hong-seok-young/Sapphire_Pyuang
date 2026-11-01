// To do 의 이벤트 할 일을 미리 정리한다 (제작자 요청 2026-11-01: 이벤트를 안 읽어도 본인 직업·레벨에 맞는 할 일을 명사형으로 딱).
// 계정 DB(D1)의 공식 글 중 최근 이벤트(120일)와 공지·안내(60일)를 Claude 가 읽고 기간 안에 챙길 일을 뽑아 official_todo 에 넣는다
// (server/todoDigest.ts 를 서버와 같이 쓴다. 원문이 바뀐 글만 다시 한다). GitHub Actions 가 공식 소식을 받은 뒤 돌린다
// (.github/workflows/official-news.yml 30분마다, deploy-web.yml 배포마다). 시간 제한이 없어 가장 좋은 모델을 높은 effort 로 쓴다
// (제작자 요청: AI 는 비용보다 품질). Cloudflare 는 무료 한도 안에서만 쓰므로 무거운 일은 여기서 한다.
// 비밀값 ANTHROPIC_API_KEY (와 있으면 ANTHROPIC_WORKSPACE_ID)가 없으면 아무것도 하지 않는다. 공개 저장소라 실행 기록에는 개수만 찍는다.
//   node --experimental-strip-types scripts/digest-official.mjs              120일 치 (남은 것 전부)
//   node --experimental-strip-types scripts/digest-official.mjs --budget 300 300초 안에 할 수 있는 만큼 (배포가 쓴다)
//   node --experimental-strip-types scripts/digest-official.mjs --local      로컬 D1 에 (시험용)
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DIGEST_MODEL, NO_TODO_TITLE, digestClient, digestPost, tasksUntil } from "../server/todoDigest.ts";

const DB = "sapphire-accounts";
const local = process.argv.includes("--local");
const where = local ? "--local" : "--remote";
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const budgetMs = Number(arg("--budget") ?? 0) * 1000;
const started = Date.now();
/** 한 번에 같이 맡기는 글 수 */
const PARALLEL = 4;
/** 다른 곳(서버)이 맡은 지 이만큼이 안 된 글은 건드리지 않는다 (server/todo.ts CLAIM_MS 와 같다) */
const CLAIM_MS = 10 * 60_000;
const DAY = 86_400_000;
const kstDate = (ms) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);

const key = process.env.ANTHROPIC_API_KEY?.trim();
if (!key) {
  console.log("ANTHROPIC_API_KEY 가 없어서 To do 정리를 건너뛰어요");
  process.exit(0);
}

const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const wrangler = (...args) => execFileSync(process.execPath, [WRANGLER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });
const parseJson = (text) => JSON.parse(text.slice(text.search(/[[{]/)));
const select = (sql) => parseJson(wrangler("d1", "execute", DB, where, "--json", "--command", sql))[0]?.results ?? [];
const q = (s) => (s === null || s === undefined ? "NULL" : typeof s === "number" ? String(s) : "'" + String(s).replace(/'/g, "''") + "'");
function runFile(sql) {
  writeFileSync("official-todo.sql", sql);
  try {
    wrangler("d1", "execute", DB, where, "--yes", "--file=official-todo.sql");
  } finally {
    rmSync("official-todo.sql", { force: true });
  }
}

/** wrangler.toml 의 database_id 가 비어 있으면(저장소에는 자리표시만 있다) 찾아 넣는다 (scripts/fetch-official.mjs 와 같다) */
function ensureDbId() {
  if (local) return;
  const toml = readFileSync("wrangler.toml", "utf8");
  if (!/^database_id = "0{8}-/m.test(toml)) return;
  const id = parseJson(wrangler("d1", "list", "--json")).find((d) => d.name === DB)?.uuid;
  if (!id) throw new Error("계정 DB를 찾지 못했어요: " + DB);
  writeFileSync("wrangler.toml", toml.replace(/^database_id = ".*"$/m, `database_id = "${id}"`));
}

ensureDbId();
// 표가 없으면 만든다 (배포 전 첫 실행이나 로컬 시험)
runFile(`CREATE TABLE IF NOT EXISTS official_todo (
  id INTEGER PRIMARY KEY, src TEXT, tasks TEXT NOT NULL, until INTEGER NOT NULL, made_at INTEGER NOT NULL, claimed_at INTEGER, model TEXT
);
CREATE INDEX IF NOT EXISTS official_todo_until ON official_todo (until);
`);

const now = Date.now();
const stale = "(t.id IS NULL OR t.made_at = 0 OR substr(t.src, 3) IS NOT substr(n.src, 3)) AND COALESCE(t.claimed_at, 0) < " + (now - CLAIM_MS);
const pending = select(
  `SELECT n.id, n.title FROM official_news n LEFT JOIN official_todo t ON t.id = n.id WHERE n.kind = 'event' AND n.start_date >= '${kstDate(now - 120 * DAY)}' AND ${stale} ` +
    `UNION ALL SELECT n.id, n.title FROM official_news n LEFT JOIN official_todo t ON t.id = n.id WHERE n.kind = 'notice' AND n.type IN ('N', 'I') ` +
    `AND n.start_date >= '${kstDate(now - 60 * DAY)}' AND ${stale} ORDER BY 1 DESC`,
);
console.log(`정리할 공식 글 ${pending.length}개`);
if (!pending.length) process.exit(0);

const client = digestClient(key, process.env.ANTHROPIC_WORKSPACE_ID);
const save = (rows) =>
  rows.length &&
  runFile(
    rows
      .map(
        (r) =>
          `INSERT INTO official_todo (id, src, tasks, until, made_at, claimed_at, model) VALUES (${r.id}, ${q(r.src)}, ${q(JSON.stringify(r.tasks))}, ${tasksUntil(r.tasks, r.start_date)}, ${r.at}, ${r.at}, ${q(DIGEST_MODEL)}) ` +
          "ON CONFLICT (id) DO UPDATE SET src = excluded.src, tasks = excluded.tasks, until = excluded.until, made_at = excluded.made_at, claimed_at = excluded.claimed_at, model = excluded.model;",
      )
      .join("\n") + "\n",
  );

let done = 0;
let empty = 0;
let failed = 0;
for (let i = 0; i < pending.length; i += PARALLEL) {
  if (budgetMs && Date.now() - started > budgetMs) {
    console.log(`시간이 다 돼서 ${pending.length - i}개는 다음에 해요`);
    break;
  }
  const ids = pending.slice(i, i + PARALLEL).map((p) => p.id);
  // 본문은 맡을 때 읽는다 (한꺼번에 읽으면 너무 크다)
  const posts = select(`SELECT id, kind, type, title, start_date, src, substr(body, 1, 20000) AS body FROM official_news WHERE id IN (${ids.join(", ")})`);
  const results = await Promise.all(
    posts.map(async (p) => {
      try {
        const tasks = NO_TODO_TITLE.test(p.title) ? [] : await digestPost(client, p);
        return { ...p, tasks, at: Date.now() };
      } catch (e) {
        failed++;
        console.log(`글 하나를 정리하지 못했어요 (${e?.status ?? ""} ${String(e?.message ?? e).slice(0, 120)})`);
        return null;
      }
    }),
  );
  const ok = results.filter(Boolean);
  save(ok);
  done += ok.length;
  empty += ok.filter((r) => !r.tasks.length).length;
}
console.log(`To do 정리 ${done}개 (할 일 없는 글 ${empty}개), 실패 ${failed}개`);
