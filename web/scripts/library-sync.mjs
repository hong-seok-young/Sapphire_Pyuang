// 자료 저장소 전체를 챗봇이 읽게 (제작자 2026-11-10 '앞으로 내가 올리는 데이터들은 모조리 아이모 데이터 레포에 넣고, 챗봇은 새로운 데이터가 레포에 등록되면
// 내가 별다른 말 안 해도 그걸 모조리 읽어서 답변하는 데 활용해').
// 비공개 자료 저장소(../자료)의 글 파일(md, txt, json, csv, tsv)을 2천 자쯤 조각으로 나눠 계정 DB(D1)의 lib_chunks 에 넣는다. 바뀐 파일만 다시 넣고 없어진 파일은 지운다
// (lib_files 의 해시). 챗봇은 질문 낱말이 든 조각을 찾아 '<길드 자료 저장소>' 로 붙인다 (server/library.ts).
// - 빼는 것: 다른 길로 이미 챗봇에 가는 것(공식/소식.json = official_news, 공식/확률 = odds.json), 받아 적기 중간 기록(도감/작업), 그림 목록·주소 목록(이미지/, scripts/,
//   드랍표_원본, 저장할_글_*, 2차_링크.json), 누가 익명 글쓴이를 보는지(길드/익명_보기.txt, 아무에게도 알리지 않는다).
// - 카톡은 같은 방을 여러 번 내보낸 파일 중 가장 새 것만 넣고(파일 이름 '<방>_<날짜>.txt'), 닉네임 뒤 휴대폰 뒷자리 '(1234)' 는 지운다.
// - 길드/ 아래(장비대여 목록, 기부 내역 등)는 운영진(오피서 이상)에게만 붙인다 (staff 1).
// 자료 저장소 main 이 바뀌면 GitHub Actions(.github/workflows/data-watch.yml, 30분마다)가 이것을 돌리고 배포도 다시 한다. 배포 끝에도 돈다.
// 공개 저장소라 실행 기록에는 파일·조각 수만 찍는다.
//   node scripts/library-sync.mjs [--local] [--sha <자료 저장소 커밋>]   (로컬 시험: D1_PERSIST=<wrangler pages dev 의 --persist-to 폴더>)
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DB = "sapphire-accounts";
const ROOT = "../자료";
const local = process.argv.includes("--local");
const where = local ? "--local" : "--remote";
const persist = local && process.env.D1_PERSIST ? [`--persist-to=${process.env.D1_PERSIST}`] : [];
const CHUNK = 2000;
const TEXT = /\.(md|txt|json|csv|tsv)$/i;
// fandom/: 해외 팬 위키를 긁은 영어 원문·목록(articles.jsonl, index.json, images.json …)은 한국어 질문에 걸리지 않고 조각만 늘린다 -> 한국어 번역(fandom/ko/*.md)과 한국어 가이드(guide_ko.txt)만
const SKIP = [/^\.git\//, /^scripts\//, /^이미지\//, /^도감\/작업\//, /^드랍표_원본\//, /^공식\/소식\.json$/, /^공식\/확률\//, /^저장할_글_/, /^2차_링크\.json$/, /^길드\/익명_보기\.txt$/, /^fandom\/(?!ko\/[^/]+\.md$|guide_ko\.txt$|그림글\.md$)/, /^링크\/.*\.json$/, /^제공\/초보자톡방_정리\.json$/]; // 초보자톡방 정리는 같은 내용의 md 만 (조각이 겹치지 않게)

if (!existsSync(ROOT)) {
  console.log("자료 저장소가 없어서 건너뛰어요");
  process.exit(0);
}
const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
// 실패해도 자료 글을 공개 실행 기록에 찍지 않는다
const wrangler = (...args) => {
  try {
    return execFileSync(process.execPath, [WRANGLER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 });
  } catch {
    console.log("wrangler 가 실패했어요");
    process.exit(1);
  }
};
const parseJson = (text) => JSON.parse(text.slice(text.search(/[[{]/)));
const query = (sql) => parseJson(wrangler("d1", "execute", DB, where, ...persist, "--json", "--command", sql))[0]?.results ?? [];
const q = (s) => (s === null || s === undefined ? "NULL" : typeof s === "number" ? String(s) : "'" + String(s).replace(/'/g, "''") + "'");
const runSql = (lines) => {
  for (let i = 0; i < lines.length; i += 400) {
    const file = join(tmpdir(), `library-sync-${process.pid}-${Date.now()}-${i}.sql`);
    writeFileSync(file, lines.slice(i, i + 400).join("\n") + "\n");
    try {
      wrangler("d1", "execute", DB, where, ...persist, "--yes", `--file=${file}`);
    } finally {
      rmSync(file, { force: true });
    }
  }
};

/** wrangler.toml 의 database_id 가 자리표시면 찾아 넣는다 (배포 서버의 작업 폴더에서만, scripts/ci-d1.mjs 와 같다) */
function ensureDbId() {
  if (local) return;
  const toml = readFileSync("wrangler.toml", "utf8");
  if (!/^database_id = "0{8}-/m.test(toml)) return;
  const id = parseJson(wrangler("d1", "list", "--json")).find((d) => d.name === DB)?.uuid;
  if (!id) throw new Error("계정 DB를 찾지 못했어요");
  writeFileSync("wrangler.toml", toml.replace(/^database_id = ".*"$/m, `database_id = "${id}"`));
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// 넣을 파일: 글 파일, 뺄 것 빼고, 카톡은 방마다 가장 새 파일만
let files = walk(ROOT)
  .map((f) => relative(ROOT, f).split(sep).join("/"))
  .filter((p) => TEXT.test(p) && !SKIP.some((re) => re.test(p)));
const newestTalk = new Map();
for (const p of files.filter((p) => p.startsWith("카톡/"))) {
  const m = p.match(/^카톡\/(.+)_(\d{4}-\d{2}-\d{2})\.txt$/);
  if (!m) continue;
  const cur = newestTalk.get(m[1]);
  if (!cur || cur.date < m[2]) newestTalk.set(m[1], { date: m[2], path: p });
}
files = files.filter((p) => {
  const m = p.match(/^카톡\/(.+)_(\d{4}-\d{2}-\d{2})\.txt$/);
  return !m || newestTalk.get(m[1])?.path === p;
});

/** 파일 글 -> 조각 (줄 단위로 2천 자쯤. JSON 은 줄을 나눠 읽기 좋게) */
function chunksOf(path, raw) {
  let text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (/\.json$/i.test(path)) {
    try {
      text = JSON.stringify(JSON.parse(text), null, 1);
    } catch {
      /* 그대로 */
    }
  }
  // 닉네임 뒤 휴대폰 뒷자리: PC 내보내기 '[닉네임(1234)] [오전 2:24]', 폰 내보내기 '2026년 …, 닉네임(1234) : '
  if (path.startsWith("카톡/"))
    text = text
      .replace(/^\[([^\]\n]*?)\s?\(\d{4}\)\] (?=\[(오전|오후) )/gm, "[$1] ")
      .replace(/^(\d{4}년 [^,\n]+, [^:\n]*?)\s?\(\d{4}\) : /gm, "$1 : ");
  const out = [];
  // 해외 위키 번역은 문서('## 이름 (영문)')를 자르지 않고 묶는다: 이름이 든 머리와 본문이 한 조각에, 긴 문서의 다음 조각에는 '## 이름 (이어서)'
  if (path.startsWith("fandom/ko/") || path === "fandom/그림글.md") {
    const docs = text.split(/\n(?=## )/);
    let pack = "";
    for (const doc of docs) {
      if (doc.length > CHUNK) {
        if (pack) out.push(pack);
        pack = "";
        const head = doc.slice(0, doc.indexOf("\n") + 1 || doc.length).trim();
        let cur = "";
        for (const line of doc.split("\n")) {
          if (cur && cur.length + line.length + 1 > CHUNK) {
            out.push(cur);
            cur = head + " (이어서)";
          }
          cur += (cur ? "\n" : "") + line;
        }
        if (cur.trim()) out.push(cur);
      } else if (pack && pack.length + doc.length + 2 > CHUNK) {
        out.push(pack);
        pack = doc;
      } else pack = pack ? pack + "\n\n" + doc : doc;
    }
    if (pack.trim()) out.push(pack);
    return out;
  }
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > CHUNK) {
      out.push(cur);
      cur = "";
    }
    // 한 줄이 아주 길면 잘라서
    for (let s = line; ; ) {
      if (s.length <= CHUNK) {
        cur += (cur ? "\n" : "") + s;
        break;
      }
      if (cur) out.push(cur);
      out.push(s.slice(0, CHUNK));
      cur = "";
      s = s.slice(CHUNK);
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

ensureDbId();
runSql([
  "CREATE TABLE IF NOT EXISTS lib_files (path TEXT PRIMARY KEY, hash TEXT NOT NULL, parts INTEGER NOT NULL, staff INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS lib_chunks (path TEXT NOT NULL, part INTEGER NOT NULL, staff INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL, PRIMARY KEY (path, part));",
]);
const had = new Map(query("SELECT path, hash FROM lib_files").map((r) => [r.path, r.hash]));
const now = Date.now();
const lines = [];
let changed = 0;
let parts = 0;
for (const p of files) {
  const raw = readFileSync(join(ROOT, p), "utf8");
  const hash = createHash("sha1").update(raw).digest("hex");
  if (had.get(p) === hash) continue;
  const chunks = chunksOf(p, raw);
  const staff = p.startsWith("길드/") ? 1 : 0;
  lines.push(`DELETE FROM lib_chunks WHERE path = ${q(p)};`);
  chunks.forEach((c, i) => lines.push(`INSERT INTO lib_chunks (path, part, staff, text) VALUES (${q(p)}, ${i}, ${staff}, ${q(c)});`));
  lines.push(
    `INSERT INTO lib_files (path, hash, parts, staff, updated_at) VALUES (${q(p)}, ${q(hash)}, ${chunks.length}, ${staff}, ${now}) ` +
      `ON CONFLICT (path) DO UPDATE SET hash = excluded.hash, parts = excluded.parts, staff = excluded.staff, updated_at = excluded.updated_at;`,
  );
  changed++;
  parts += chunks.length;
}
const gone = [...had.keys()].filter((p) => !files.includes(p));
for (const p of gone) lines.push(`DELETE FROM lib_chunks WHERE path = ${q(p)};`, `DELETE FROM lib_files WHERE path = ${q(p)};`);
// 이 저장소 판을 넣었다고 적는다 (data-watch.yml 이 같은 판으로 배포를 또 부르지 않게)
const sha = process.argv[process.argv.indexOf("--sha") + 1];
if (process.argv.includes("--sha") && /^[0-9a-f]{40}$/.test(sha ?? ""))
  lines.push(`INSERT OR IGNORE INTO setup (key, done_at) VALUES ('data_ok_${sha}', ${now});`);
if (lines.length) runSql(lines);
console.log(`자료 저장소 → 챗봇: 파일 ${files.length}개 중 바뀐 ${changed}개(조각 ${parts}개) 넣음, 없어진 ${gone.length}개 뺌`);
