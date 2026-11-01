// 컴투스 공식 소식 (withhive.com 아이모 공지사항·점검·이벤트)을 받아 계정 DB(D1)의 official_news 표에 넣는다 (제작자 요청 2026-11-01).
// GitHub Actions(.github/workflows/official-news.yml)가 30분마다 돌린다. 표가 비었거나 --all 이면 모든 쪽을, 아니면 최근 것만 받는다.
// 공개 페이지가 쓰는 목록 주소(POST /api/notice/list/32, 한국어는 language=ko 쿠키)를 그대로 부르고 요청 사이를 띄운다.
// 본문은 그림과 꾸밈을 빼고 글자만 둔다 (챗봇이 읽는다). 화면은 제목과 날짜만 보이고 누르면 공식 페이지를 연다.
// 기록은 지우지 않는다 (CLAUDE.md '기록은 평생'). 공개 저장소라 실행 기록에는 개수만 찍는다.
//   node scripts/fetch-official.mjs          최근 것만 (쪽마다 30개)
//   node scripts/fetch-official.mjs --all    모든 쪽
//   node scripts/fetch-official.mjs --local  로컬 D1 에 (시험용)
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  image TEXT, body TEXT NOT NULL, fetched_at INTEGER NOT NULL
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

const ENTITY = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };

/** 공식 글의 HTML -> 글자 (줄은 남기고 그림, 꾸밈은 뺀다). 표는 칸을 ' | ' 로 */
function htmlToText(html) {
  return String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|li|tr|table|h[1-6]|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITY[e.toLowerCase()] ?? m;
    })
    .replace(/[​-‍﻿]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\| *(\n|$)/g, "$1")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const clean = (s) => String(s ?? "").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
const q = (s) => (s === null || s === undefined || s === "" ? "NULL" : "'" + String(s).replace(/\u0000/g, "").replace(/'/g, "''") + "'");
const day = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

function upsert(item, kind, now) {
  const image = item.cropImage ? (String(item.cropImage).startsWith("//") ? "https:" + item.cropImage : item.cropImage) : null;
  const body = htmlToText(item.content).slice(0, 30_000);
  const values = [Number(item.noticeId), q(kind), q(item.type || (kind === "event" ? "E" : "N")), q(clean(item.noticeTitle)), q(day(item.startTime)), q(day(item.endTime)), q(image), q(body), now];
  // 바뀐 것만 고친다 (그대로면 쓰지 않아서 D1 쓰기 한도를 아낀다)
  return (
    "INSERT INTO official_news (id, kind, type, title, start_date, end_date, image, body, fetched_at) VALUES (" + values.join(", ") + ") " +
    "ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, type = excluded.type, title = excluded.title, start_date = excluded.start_date, " +
    "end_date = excluded.end_date, image = excluded.image, body = excluded.body, fetched_at = excluded.fetched_at " +
    "WHERE official_news.title IS NOT excluded.title OR official_news.body IS NOT excluded.body OR official_news.type IS NOT excluded.type " +
    "OR official_news.start_date IS NOT excluded.start_date OR official_news.end_date IS NOT excluded.end_date OR official_news.image IS NOT excluded.image;"
  );
}

ensureDbId();
runFile(CREATE + "\n");
const count = Number(parseJson(wrangler("d1", "execute", DB, where, "--json", "--command", "SELECT COUNT(*) AS n FROM official_news"))[0]?.results?.[0]?.n ?? 0);
const all = process.argv.includes("--all") || count === 0;
const rows = all ? 50 : 30;
const now = Date.now();
const statements = [];
for (const { type, kind } of KINDS) {
  let page = 1;
  let got = 0;
  for (;;) {
    const { total, list } = await fetchPage(type, page, rows);
    for (const item of list) if (item?.noticeId) statements.push(upsert(item, kind, now));
    got += list.length;
    if (!all || list.length < rows || got >= total || page >= 40) break;
    page += 1;
    await sleep(800);
  }
  console.log(`${kind === "event" ? "이벤트" : "공지사항"} ${got}개를 받았어요`);
  await sleep(800);
}

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
runFile(`INSERT OR REPLACE INTO setup (key, done_at) VALUES ('official_checked', ${now});\n`);
console.log(`공식 소식 ${statements.length}개를 맞췄어요 (${all ? "모든 쪽" : "최근 것"})`);
