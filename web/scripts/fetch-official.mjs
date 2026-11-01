// 컴투스 공식 소식 (withhive.com 아이모 공지사항·점검·이벤트)을 받아 계정 DB(D1)의 official_news 표에 넣는다 (제작자 요청 2026-11-01).
// GitHub Actions(.github/workflows/official-news.yml)가 30분마다 돌린다. 표가 비었거나 --all 이면 모든 쪽을, 아니면 최근 것만 받는다.
// 공개 페이지가 쓰는 목록 주소(POST /api/notice/list/32, 한국어는 language=ko 쿠키)를 그대로 부르고 요청 사이를 띄운다.
// 본문은 두 가지로 둔다: 글자만(body, 챗봇이 읽는다)과 간단히 한 HTML(html: 문단, 굵게, 표, 목록, 그림, 링크만. 꾸밈과 속성은 뺀다).
// 게시판 '아이모 소식'에서 앱 안에서 읽는다 (제작자 요청 2026-11-01). 화면은 html 을 다시 한 번 걸러서 그린다 (pages/Official.tsx).
// 기록은 지우지 않는다 (CLAUDE.md '기록은 평생'). 공개 저장소라 실행 기록에는 개수만 찍는다.
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
  image TEXT, body TEXT NOT NULL, fetched_at INTEGER NOT NULL, html TEXT
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

/** 그림, 링크 주소: https 만 (//로 시작하면 https 를 붙인다). 아니면 null */
function safeUrl(raw) {
  const s = String(raw ?? "").trim().replace(/&amp;/g, "&");
  const full = s.startsWith("//") ? "https:" + s : s;
  try {
    const u = new URL(full);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href.replace(/"/g, "%22") : null;
  } catch {
    return null;
  }
}
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? m[2] ?? m[3] ?? m[4] : null;
};
/** 남기는 태그 (나머지는 태그만 빼고 글자는 둔다). 꾸밈 속성은 모두 뺀다 */
const KEEP = { p: "p", div: "p", br: "br", b: "b", strong: "b", i: "i", em: "i", u: "u", h1: "h4", h2: "h4", h3: "h4", h4: "h4", h5: "h4", h6: "h4",
  ul: "ul", ol: "ol", li: "li", table: "table", thead: "thead", tbody: "tbody", tr: "tr", td: "td", th: "th", hr: "hr", blockquote: "blockquote", img: "img", a: "a" };

/** UTF-8 바이트 수 (D1 은 SQL 한 줄이 100KB 를 넘으면 받지 않는다. 한글은 한 글자 3바이트) */
const bytes = (s) => Buffer.byteLength(s ?? "", "utf8");
/** max 바이트 안에 들어가게 뒤를 자른다 */
function fitBytes(s, max) {
  if (bytes(s) <= max) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bytes(s.slice(0, mid)) <= max) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo);
}

/** 공식 글 HTML -> 간단한 HTML (58KB 넘으면 null: 그때는 글자만 보인다) */
function simpleHtml(html) {
  const out = String(html ?? "")
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (tag, close, name) => {
      const t = KEEP[name.toLowerCase()];
      if (!t) return "";
      if (t === "img") {
        if (close) return "";
        const src = safeUrl(attr(tag, "src"));
        return src ? `<img src="${src}">` : "";
      }
      if (t === "a" && !close) {
        const href = safeUrl(attr(tag, "href"));
        return href ? `<a href="${href}">` : "<a>";
      }
      if (t === "br" || t === "hr") return close ? "" : `<${t}>`;
      return `<${close}${t}>`;
    })
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .replace(/<p>\s*(<br>\s*)*<\/p>/g, "")
    .trim();
  return bytes(out) > 58_000 ? null : out;
}

const clean = (s) => String(s ?? "").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
const q = (s) => (s === null || s === undefined || s === "" ? "NULL" : "'" + String(s).replace(/\u0000/g, "").replace(/'/g, "''") + "'");
const day = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** withhive 목록의 글 하나 -> 표의 한 줄 */
function rowOf(item, kind) {
  const image = item.cropImage ? (String(item.cropImage).startsWith("//") ? "https:" + item.cropImage : item.cropImage) : null;
  return {
    id: Number(item.noticeId), kind, type: item.type || (kind === "event" ? "E" : "N"), title: clean(item.noticeTitle),
    start_date: day(item.startTime), end_date: day(item.endTime), image, body: fitBytes(htmlToText(item.content), 22_000),
    html: simpleHtml(item.content),
  };
}

function upsert(r, now) {
  const values = [r.id, q(r.kind), q(r.type), q(r.title), q(r.start_date), q(r.end_date), q(r.image), q(r.body), now, q(r.html)];
  // 바뀐 것만 고친다 (그대로면 쓰지 않아서 D1 쓰기 한도를 아낀다)
  return (
    "INSERT INTO official_news (id, kind, type, title, start_date, end_date, image, body, fetched_at, html) VALUES (" + values.join(", ") + ") " +
    "ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, type = excluded.type, title = excluded.title, start_date = excluded.start_date, " +
    "end_date = excluded.end_date, image = excluded.image, body = excluded.body, fetched_at = excluded.fetched_at, html = excluded.html " +
    "WHERE official_news.title IS NOT excluded.title OR official_news.body IS NOT excluded.body OR official_news.type IS NOT excluded.type " +
    "OR official_news.html IS NOT excluded.html " +
    "OR official_news.start_date IS NOT excluded.start_date OR official_news.end_date IS NOT excluded.end_date OR official_news.image IS NOT excluded.image;"
  );
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
  if (!cols.some((c) => c.name === "html")) wrangler("d1", "execute", DB, where, "--yes", "--command", "ALTER TABLE official_news ADD COLUMN html TEXT");
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
