// 컴투스 공식 소식 (withhive.com 아이모 공지사항·점검·이벤트)을 받아 계정 DB(D1)의 official_news 표에 넣는다 (제작자 요청 2026-11-01).
// GitHub Actions(.github/workflows/official-news.yml)가 30분마다 돌린다. 표가 비었거나 --all 이면 모든 쪽을, 아니면 최근 것만 받는다.
// 공개 페이지가 쓰는 목록 주소(POST /api/notice/list/32, 한국어는 language=ko 쿠키)를 그대로 부르고 요청 사이를 띄운다.
// 본문은 두 가지로 둔다: 글자만(body, 챗봇이 읽는다)과 간단히 한 HTML(html: 문단, 굵게, 표, 목록, 그림, 링크만. 꾸밈과 속성은 뺀다).
// 게시판 '아이모 소식'에서 앱 안에서 읽는다 (제작자 요청 2026-11-01). 화면은 html 을 다시 한 번 걸러서 그린다 (pages/Official.tsx).
// 기록은 지우지 않는다 (CLAUDE.md '기록은 평생'). 공개 저장소라 실행 기록에는 개수만 찍는다.
// 글을 바꾸는 방법(본문 글자, 간단한 HTML, 원문 해시)은 서버의 점검 글 새로 받기와 같아야 해서 server/officialText.ts 하나를 같이 쓴다
// (Node 가 타입을 지우고 읽는다: node --experimental-strip-types). 원문이 그대로면 쓰지 않는다 (src).
// withhive 는 한국 밖에서 부르면 한국 전용 글(원스토어 프로모션, 국내 콜라보 등)을 빼고 준다. GitHub 서버와 Cloudflare 서버는 모두 한국 밖으로 잡혀서,
// 한국 전용 글은 한국 PC에서 --save 로 비공개 자료 저장소(자료/공식/소식.json)에 받아 두고 배포가 --load 로 넣는다 (공식 확률과 같은 길).
//   node scripts/fetch-official.mjs          최근 것만 (쪽마다 30개)
//   node scripts/fetch-official.mjs --all    모든 쪽
//   node scripts/fetch-official.mjs --local  로컬 D1 에 (시험용)
//   node scripts/fetch-official.mjs --save ../자료/공식/소식.json   모든 쪽을 파일로만 (한국 PC에서)
//   node scripts/fetch-official.mjs --load ../자료/공식/소식.json   그 파일을 DB 에 (배포가 한다)
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { UPSERT_SQL, rowOf, upsertValues } from "../server/officialText.ts";

const DB = "sapphire-accounts";
const GAME = 32; // withhive 의 아이모 번호
const KINDS = [
  { type: "", kind: "notice" }, // 공지사항 (공지 N, 점검 C, 안내 I, 오류 D)
  { type: "E", kind: "event" }, // 이벤트
];
const local = process.argv.includes("--local");
const where = local ? "--local" : "--remote";

const CREATE = `CREATE TABLE IF NOT EXISTS official_news (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, start_date TEXT, end_date TEXT,
  image TEXT, body TEXT NOT NULL, fetched_at INTEGER NOT NULL, html TEXT, src TEXT
);
CREATE INDEX IF NOT EXISTS official_news_kind ON official_news (kind, id);`;

/** wrangler 를 셸 없이 node 로 바로 돌린다 (윈도우에서 시험할 때도 SQL 글자가 셸에 갈라지지 않게) */
const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
function wrangler(...args) {
  return execFileSync(process.execPath, [WRANGLER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}
const parseJson = (text) => JSON.parse(text.slice(text.search(/[[{]/)));

/** wrangler.toml 의 database_id 가 비어 있으면(저장소에는 자리표시만 있다) 찾아 넣는다. 배포 서버의 작업 폴더에서만 바꾼다 (scripts/ci-d1.mjs 와 같다) */
function ensureDbId() {
  if (local) return;
  const toml = readFileSync("wrangler.toml", "utf8");
  if (!/^database_id = "0{8}-/m.test(toml)) return;
  const id = parseJson(wrangler("d1", "list", "--json")).find((d) => d.name === DB)?.uuid;
  if (!id) throw new Error("계정 DB를 찾지 못했어요: " + DB);
  writeFileSync("wrangler.toml", toml.replace(/^database_id = ".*"$/m, `database_id = "${id}"`));
}

function runFile(sql) {
  writeFileSync("official-news.sql", sql);
  try {
    wrangler("d1", "execute", DB, where, "--yes", "--file=official-news.sql");
  } finally {
    rmSync("official-news.sql", { force: true });
  }
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function fetchPage(type, page, rows) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`https://withhive.com/api/notice/list/${GAME}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-requested-with": "XMLHttpRequest",
          accept: "application/json",
          cookie: "language=ko",
        },
        body: `page=${page}&type=${type}&rows=${rows}`,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()).data;
      return { total: Number(data?.total_count) || 0, list: Array.isArray(data?.notice_list) ? data.notice_list : [] };
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(3000 * attempt);
    }
  }
}

const q = (s) => (s === null || s === undefined || s === "" ? "NULL" : typeof s === "number" ? String(s) : "'" + String(s).replace(/\u0000/g, "").replace(/'/g, "''") + "'");

/** 표에 넣는 SQL 한 줄 (server/officialText.ts 의 UPSERT_SQL 에 값을 글자로 넣는다: wrangler 파일 실행은 값을 따로 못 넘긴다) */
function upsert(r, now) {
  const values = upsertValues(r, now);
  return UPSERT_SQL.replace(/\?(\d+)/g, (_, n) => q(values[Number(n) - 1])) + ";";
}

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const saveTo = arg("--save");
const loadFrom = arg("--load");

/** withhive 에서 받는다 (all: 모든 쪽, 아니면 쪽마다 30개) */
async function fetchRows(all) {
  const rows = all ? 50 : 30;
  const out = [];
  for (const { type, kind } of KINDS) {
    let page = 1;
    let got = 0;
    for (;;) {
      const { total, list } = await fetchPage(type, page, rows);
      for (const item of list) if (item?.noticeId) out.push(rowOf(item, kind));
      got += list.length;
      if (!all || list.length < rows || got >= total || page >= 40) break;
      page += 1;
      await sleep(800);
    }
    console.log(`${kind === "event" ? "이벤트" : "공지사항"} ${got}개를 받았어요`);
    await sleep(800);
  }
  return out;
}

if (saveTo) {
  const rows = await fetchRows(true);
  writeFileSync(saveTo, JSON.stringify({ savedAt: new Date().toISOString(), rows }, null, 0) + "\n");
  console.log(`${rows.length}개를 ${saveTo} 에 적었어요`);
  process.exit(0);
}

ensureDbId();
runFile(CREATE + "\n");
{
  const cols = parseJson(wrangler("d1", "execute", DB, where, "--json", "--command", "PRAGMA table_info(official_news)"))[0]?.results ?? [];
  for (const col of ["html", "src"]) {
    if (!cols.some((c) => c.name === col)) wrangler("d1", "execute", DB, where, "--yes", "--command", `ALTER TABLE official_news ADD COLUMN ${col} TEXT`);
  }
}
let all = false;
let found;
if (loadFrom) {
  found = JSON.parse(readFileSync(loadFrom, "utf8")).rows;
  console.log(`파일에서 ${found.length}개를 읽었어요`);
} else {
  const count = Number(parseJson(wrangler("d1", "execute", DB, where, "--json", "--command", "SELECT COUNT(*) AS n FROM official_news"))[0]?.results?.[0]?.n ?? 0);
  all = process.argv.includes("--all") || count === 0;
  found = await fetchRows(all);
}
const now = Date.now();
const statements = found.filter((r) => Number.isInteger(r?.id) && r.title).map((r) => upsert(r, now));

// 너무 큰 파일은 나눠 넣는다 (D1 한 번에 넣는 크기)
let chunk = [];
let size = 0;
for (const s of statements) {
  if (size + s.length > 400_000 && chunk.length) {
    runFile(chunk.join("\n") + "\n");
    chunk = [];
    size = 0;
  }
  chunk.push(s);
  size += s.length;
}
if (chunk.length) runFile(chunk.join("\n") + "\n");
if (!loadFrom) runFile(`INSERT OR REPLACE INTO setup (key, done_at) VALUES ('official_checked', ${now});\n`);
console.log(`공식 소식 ${statements.length}개를 맞췄어요 (${loadFrom ? "한국 PC에서 받아 둔 것" : all ? "모든 쪽" : "최근 것"})`);
