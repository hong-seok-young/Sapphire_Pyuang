// 자동 배포(.github/workflows/deploy-web.yml)에서 계정 DB(D1)를 준비한다.
//  1. sapphire-accounts DB 가 없으면 아시아(apac)에 만들고, 그 database_id 를 wrangler.toml 에 넣는다
//     (배포하는 서버의 작업 폴더에서만 바꾸고 커밋하지 않는다)
//     사용 기록 DB 2~10(sapphire-log-2 ~ 10)도 없으면 만들고 차례가 돌아온 가장 오래된 것은 비운다 (아래 '사용 기록 DB 2~10')
//  2. schema.sql 을 넣는다 (CREATE TABLE IF NOT EXISTS 라 몇 번을 해도 된다). 이미 있는 표에 나중에 더한 칸은 ALTER TABLE 로 넣는다
//  3. 계정이 하나도 없을 때만 앱개발자 계정(퓨앙)을 저장소 비밀값 DEV_PASSWORD 로 만든다.
//  4. 저장소 비밀값 FIRST_PASSWORD 가 있으면 시작 계정(길드마스터, 오피서)을 한 번만 만든다 (제작자 요청).
//     이미 있는 아이디는 그대로 두고, 한 번 만든 뒤에는 다시 만들지 않는다 (지운 계정이 배포 때 되살아나지 않게).
//  5. 정식 오픈 글(src/opening.json, 길드마스터)을 첫 공지사항으로 한 번 올리고 모두에게 알림을 넣는다 (setup 'opening_notice').
// 3, 4 의 계정은 처음 로그인하면 비밀번호를 바꾸게 한다. 그 밖의 길드원은 '길드원 관리'에서 만든다.
// 공개 저장소라 실행 기록을 누구나 볼 수 있으므로 비밀번호, 해시, SQL 은 화면에 찍지 않는다.
import { execFileSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const DB = "sapphire-accounts";
const DEVELOPER = "퓨앙";
/** 시작 계정: 길드마스터와 오피서 (README '길드 계정' 표와 같다) */
const STARTING = [
  ["마을모금함", "master"],
  ["멍멍", "officer"],
  ["유어아너", "officer"],
  ["아홀로틀", "officer"],
  ["정서", "officer"],
  ["향단", "officer"],
];
const ITER = 10000; // server/auth.ts 의 PBKDF2_ITER 와 같아야 한다

/** wrangler 를 실행하고 표준 출력을 돌려준다 (화면에는 안 찍는다. 오류는 그대로 보인다) */
function wrangler(...args) {
  return execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

/** --json 출력에서 JSON 부분만 읽는다 */
function parseJson(text) {
  return JSON.parse(text.slice(text.search(/[[{]/)));
}

/** SQL 한 줄로 고른 첫 줄 (없으면 undefined) */
function queryFirst(sql) {
  return parseJson(wrangler("d1", "execute", DB, "--remote", "--json", "--command", sql))[0]?.results?.[0];
}

/** SQL 파일을 만들어 넣고 지운다 (파일 내용은 화면에 안 나온다) */
function runSql(lines) {
  writeFileSync("setup-accounts.sql", lines.join("\n") + "\n");
  try {
    wrangler("d1", "execute", DB, "--remote", "--yes", "--file=setup-accounts.sql");
  } finally {
    rmSync("setup-accounts.sql", { force: true });
  }
}

/** 처음 비밀번호로 계정을 넣는 SQL (이미 있는 아이디는 건드리지 않는다) */
function insertUser(id, role, password, now) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, ITER, 32, "sha256").toString("base64");
  const values = [`'${id}'`, `'${role}'`, `'${hash}'`, `'${salt.toString("base64")}'`, ITER, 1, now, "'setup'"];
  return "INSERT OR IGNORE INTO users (id, role, pw_hash, pw_salt, pw_iter, must_change, created_at, created_by) VALUES (" + values.join(", ") + ");";
}

const dbList = () => parseJson(wrangler("d1", "list", "--json"));
function findDb(name = DB) {
  return dbList().find((d) => d.name === name)?.uuid;
}

/** wrangler.toml 에서 그 바인딩의 database_id 를 바꾼다 (배포하는 서버의 작업 폴더에서만, 커밋하지 않는다) */
let toml = readFileSync("wrangler.toml", "utf8");
function setDbId(binding, uuid) {
  const next = toml.replace(new RegExp(`(binding = "${binding}"\\n(?:[^\\n]*\\n)*?database_id = )"[^"]*"`), `$1"${uuid}"`);
  if (next === toml && !toml.includes(`"${uuid}"`)) throw new Error(`wrangler.toml 에 ${binding} 바인딩이 없어요`);
  toml = next;
  writeFileSync("wrangler.toml", toml);
}

let id = findDb();
if (!id) {
  wrangler("d1", "create", DB, "--location=apac", "--update-config=false");
  id = findDb();
  console.log("계정 DB를 새로 만들었어요");
}
if (!id) throw new Error("계정 DB를 찾지 못했어요: " + DB);
setDbId("DB", id);

wrangler("d1", "execute", DB, "--remote", "--yes", "--file=schema.sql");

/** schema.sql 은 이미 있는 표를 바꾸지 않는다. 나중에 더한 칸: [표, 칸, 종류] */
const ADDED_COLUMNS = [
  ["profiles", "exp", "INTEGER"], ["listings", "options", "TEXT"], ["profiles", "guild", "TEXT"],
  ["listings", "mode", "TEXT NOT NULL DEFAULT 'sale'"], ["listings", "ends_at", "INTEGER"], ["listing_wants", "offer", "INTEGER"],
  ["listing_talk", "parent_id", "INTEGER"],
  ["users", "high_spec", "INTEGER NOT NULL DEFAULT 0"], ["plat_settings", "high_ratio", "REAL NOT NULL DEFAULT 4"],
  ["plat_items", "high_ratio", "REAL"],
  ["activity", "ip", "TEXT"],
  ["activity", "place", "TEXT"],
  ["activity", "device", "TEXT"],
  ["activity", "dev", "TEXT"],
  ["alert_prefs", "push", "INTEGER"],
  ["users", "push_perm", "TEXT"], ["users", "push_at", "INTEGER"],
  ["listings", "auto_auction", "INTEGER"],
  ["plat_settings", "week_plat", "INTEGER NOT NULL DEFAULT 300"], ["plat_settings", "high_week_plat", "INTEGER NOT NULL DEFAULT 300"],
  ["users", "main_id", "TEXT"], ["signup_requests", "owner", "TEXT"],
  ["listings", "sale_when", "TEXT"],
  ["users", "kakao", "TEXT"],
  // 길드 던전 파티 단계 (제작자 2026-11-03)
  ["gd_parties", "stage", "INTEGER"],
  ["plat_orders", "voided_at", "INTEGER"], ["plat_orders", "voided_by", "TEXT"], ["plat_orders", "gold_paid", "INTEGER"],
  ["official_news", "html", "TEXT"], ["official_news", "src", "TEXT"], ["official_news", "added_at", "INTEGER"],
  ["rental_requests", "app_id", "INTEGER"],
  ["rental_requests", "gold", "INTEGER"],
  ["rental_items", "return_req_at", "INTEGER"], ["rental_items", "return_app_id", "INTEGER"],
];
for (const [table, column, type] of ADDED_COLUMNS) {
  const columns = parseJson(wrangler("d1", "execute", DB, "--remote", "--json", "--command", `PRAGMA table_info(${table})`))[0]?.results ?? [];
  if (!columns.some((c) => c.name === column)) {
    wrangler("d1", "execute", DB, "--remote", "--yes", "--command", `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`${table} 표에 ${column} 칸을 더했어요`);
  }
}
// 사용 기록 DB 2~10 (server/logdb.ts, 제작자 요청 2026-11-02: 'DB 10개를 미리 해 놔', '1부터 채우고 2 3 4 진행하고 10까지 차면 1을 비우고').
// 무료 요금제는 DB 10개(합쳐 5GB)까지: DB 1(sapphire-accounts)은 계정·글·사진이라 비우지 않고, 사용 기록만 sapphire-log-2 ~ 10 을 차례로 쓴다.
//  1. 없는 DB 는 아시아(apac)에 만들고 표(schema-log.sql)를 넣는다. wrangler.toml 의 LOG2 ~ LOG10 에 그 id 를 넣는다
//  2. 지금 쓰는 DB 가 절반을 넘었는데 다음 차례 DB 에 예전 기록이 남아 있으면(DB 10 다음 DB 2 처럼 한 바퀴 돈 때) 그 DB 를 지웠다 새로 만들어 비운다.
//     행을 지우면 무료 쓰기 한도(하루 10만 줄)를 다 써서 DB 째 새로 만든다. 새 id 는 이번 배포에 들어간다
{
  const LOG_NUMS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
  const LOG_FULL = 450 * 1024 * 1024; // server/logdb.ts 와 같게
  const logName = (n) => `sapphire-log-${n}`;
  // wrangler 는 DB 이름을 wrangler.toml 에서 먼저 찾아서, 그 바인딩의 id 를 진짜 id 로 바꾼 뒤에 그 DB 에 무엇을 한다
  // (2026-11-02 첫 배포: 자리 표시 id 로 표를 넣으려다 실패했다)
  const schemaLog = (n) => wrangler("d1", "execute", logName(n), "--remote", "--yes", "--file=schema-log.sql");
  const makeLog = (n) => {
    wrangler("d1", "create", logName(n), "--location=apac", "--update-config=false");
    const uuid = findDb(logName(n));
    if (!uuid) throw new Error("사용 기록 DB를 만들지 못했어요: " + logName(n));
    setDbId(`LOG${n}`, uuid);
    schemaLog(n);
    return uuid;
  };
  const list = dbList();
  const ids = new Map();
  for (const n of LOG_NUMS) {
    let uuid = list.find((d) => d.name === logName(n))?.uuid;
    if (!uuid) {
      try {
        uuid = makeLog(n);
        console.log(`사용 기록 DB ${n}을 만들었어요`);
      } catch {
        // 계정에 다른 DB 가 있어 무료 10개를 넘는 등: 그 DB 없이 배포한다 (server/logdb.ts 는 없는 DB 를 건너뛴다)
        console.log(`::warning::사용 기록 DB ${n}을 만들지 못해서 빼고 배포해요 (Cloudflare 무료 요금제는 DB 10개까지)`);
        toml = toml.replace(new RegExp(`\\[\\[d1_databases\\]\\]\\nbinding = "LOG${n}"\\n[^\\n]*\\n[^\\n]*\\n\\n?`), "");
        writeFileSync("wrangler.toml", toml);
        continue;
      }
    }
    setDbId(`LOG${n}`, uuid);
    ids.set(n, uuid);
  }
  // 표는 한 번만 모두에 넣는다 (DB 마다 몇 초씩 걸려서 배포 때마다 하지 않는다. 새로 만든 DB 는 위에서 넣었다)
  if (!queryFirst("SELECT 1 AS done FROM setup WHERE key = 'log_schema_v1'")) {
    for (const n of ids.keys()) schemaLog(n);
    runSql([`INSERT OR REPLACE INTO setup (key, done_at) VALUES ('log_schema_v1', ${Date.now()});`]);
    console.log(`사용 기록 DB ${[...ids.keys()].join(", ")}에 표를 넣었어요`);
  }
  const ring = parseJson(
    wrangler("d1", "execute", DB, "--remote", "--json", "--command", "SELECT n, started_at FROM log_ring WHERE started_at IS NOT NULL ORDER BY started_at DESC"),
  )[0]?.results ?? [];
  if (ring.length) {
    const cur = Number(ring[0].n);
    const next = LOG_NUMS[(LOG_NUMS.indexOf(cur) + 1) % LOG_NUMS.length];
    const size = Number(parseJson(wrangler("d1", "execute", logName(cur), "--remote", "--json", "--command", "SELECT 1 AS one"))[0]?.meta?.size_after ?? 0);
    console.log(`사용 기록은 DB ${cur}에 쓰는 중 (${Math.round(size / 1024 / 1024)}MB / ${LOG_FULL / 1024 / 1024}MB)`);
    if (ids.has(next) && ring.some((r) => Number(r.n) === next) && size > LOG_FULL / 2) {
      wrangler("d1", "delete", logName(next), "-y");
      ids.set(next, makeLog(next));
      wrangler("d1", "execute", DB, "--remote", "--yes", "--command", `UPDATE log_ring SET started_at = NULL, base = NULL, cleared_at = ${Date.now()} WHERE n = ${next}`);
      console.log(`다음 차례 DB ${next}의 가장 오래된 사용 기록을 비웠어요`);
    }
  }
}

// 의뢰소 고도화 (제작자 요청 2026-11-03): 예전 한 사람 수락(accepter)을 수락 줄(request_offers)로 옮기고, 예전 '진행 중'은 모집 중으로.
// NOT EXISTS 라 몇 번을 해도 된다
runSql([
  "INSERT INTO request_offers (request_id, user_id, note, status, created_at, updated_at) " +
    "SELECT id, accepter, NULL, 'pledged', COALESCE(accepted_at, updated_at), updated_at FROM requests " +
    "WHERE accepter IS NOT NULL AND NOT EXISTS (SELECT 1 FROM request_offers o WHERE o.request_id = requests.id);",
  "UPDATE requests SET status = 'open' WHERE status = 'accepted';",
]);

// 길드 던전 파티는 미리 짜 주지 않는다 (제작자 2026-11-03 '파티 미리 짜 주지 말자, 사용 좀 해 보라고, 각자 직접 짜게'): 11/3 에 세팅 스크립트(gd-seed.mjs, 지금은 없음)가
// 자료 파일로 만든 파티 8개와 그때 보낸 알림을 지운다. 세팅은 파티·파티원·알림·setup 'gd_seed_<해시>' 를 모두 같은 때(done_at)로 넣었으므로 그 때로 찾는다.
// 길드원이 직접 만든 파티와 시간표(gd_avail)는 그대로. setup 줄을 마지막에 지우므로 한 번 지우면 다시 돌아도 아무것도 안 한다. 공지 전 숨김 스위치('gd_parties_open')도 뺀다
runSql([
  "DELETE FROM gd_answers WHERE party_id IN (SELECT id FROM gd_parties WHERE created_at IN (SELECT done_at FROM setup WHERE key LIKE 'gd_seed_%'));",
  "DELETE FROM gd_members WHERE party_id IN (SELECT id FROM gd_parties WHERE created_at IN (SELECT done_at FROM setup WHERE key LIKE 'gd_seed_%'));",
  "DELETE FROM alerts WHERE kind = 'gdungeon' AND created_at IN (SELECT done_at FROM setup WHERE key LIKE 'gd_seed_%');",
  "DELETE FROM gd_parties WHERE created_at IN (SELECT done_at FROM setup WHERE key LIKE 'gd_seed_%');",
  "DELETE FROM setup WHERE key LIKE 'gd_seed_%' OR key = 'gd_parties_open';",
]);

// 더한 칸의 색인 (schema.sql 은 칸이 생기기 전에 돌아서 여기서 만든다)
wrangler("d1", "execute", DB, "--remote", "--yes", "--command", "CREATE INDEX IF NOT EXISTS official_news_added ON official_news (added_at)");

// 아이모 소식 새 글 배지·알림 (제작자 요청 2026-11-02: '새 이벤트 수집했으니 게시판 배지 다시 띄워 줘, 웹 알림도'): added_at 칸이 생기기 전에 들어온 글 중
// 한국 PC 파일(자료/공식/소식.json)에 없는 글은 그 파일을 저장한 뒤에 새로 올라온 글이다. 한 번만 지금 들어온 것으로 적어 배지가 뜨게 하고,
// 알림은 그 파일을 저장한 때 뒤에 들어온 글부터 보낸다 (setup 'official_announced', server/officialAlert.ts)
if (!queryFirst("SELECT 1 AS done FROM setup WHERE key = 'official_added_backfill'")) {
  const file = "../자료/공식/소식.json";
  const now = Date.now();
  let saved = now;
  let ids = [];
  if (existsSync(file)) {
    const snap = JSON.parse(readFileSync(file, "utf8"));
    saved = Date.parse(snap.savedAt) || now;
    ids = (snap.rows ?? []).map((r) => Number(r.id)).filter(Number.isInteger);
  }
  runSql([
    `UPDATE official_news SET added_at = ${now} WHERE added_at IS NULL AND ${ids.length ? `id NOT IN (${ids.join(",")})` : "0"};`,
    `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('official_announced', ${saved});`,
    `INSERT OR REPLACE INTO setup (key, done_at) VALUES ('official_added_backfill', ${now});`,
  ]);
  console.log("아이모 소식 새 글 표시를 맞췄어요");
}

const count = Number(queryFirst("SELECT COUNT(*) AS n FROM users")?.n ?? 0);
if (count > 0) {
  console.log(`계정 ${count}개`);
} else {
  const password = process.env.DEV_PASSWORD ?? "";
  if (password.length < 6) {
    console.log("::warning::계정이 하나도 없는데 DEV_PASSWORD 비밀값이 없거나 6자보다 짧아서 첫 계정을 못 만들었어요");
  } else {
    runSql([insertUser(DEVELOPER, "developer", password, Date.now())]);
    console.log(`첫 계정(${DEVELOPER})을 만들었어요`);
  }
}

const first = process.env.FIRST_PASSWORD ?? "";
if (first) {
  if (queryFirst("SELECT 1 AS done FROM setup WHERE key = 'starting_accounts'")) {
    console.log("시작 계정은 이미 만들었어요");
  } else if (first.length < 6) {
    console.log("::warning::FIRST_PASSWORD 가 6자보다 짧아서 시작 계정을 못 만들었어요");
  } else {
    const now = Date.now();
    runSql([
      ...STARTING.map(([user, role]) => insertUser(user, role, first, now)),
      `INSERT OR REPLACE INTO setup (key, done_at) VALUES ('starting_accounts', ${now});`,
    ]);
    console.log(`시작 계정(${STARTING.map(([user]) => user).join(", ")})을 만들었어요. 처음 로그인하면 비밀번호를 바꿔요`);
  }
}

// 정식 오픈 글을 첫 공지사항으로 한 번 (제작자 요청 2026-11-01). 이미 올렸으면 그대로 둔다 (길드마스터가 고치거나 지워도 되살리지 않게)
if (queryFirst("SELECT 1 AS done FROM setup WHERE key = 'opening_notice'")) {
  console.log("오픈 공지는 이미 올렸어요");
} else {
  const opening = JSON.parse(readFileSync("src/opening.json", "utf8"));
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const now = Date.now();
  runSql([
    `INSERT INTO board_posts (cat, author, title, body, pinned, created_at) VALUES ('notice', ${q(opening.author)}, ${q(opening.title)}, ${q(opening.body)}, 1, ${now});`,
    `INSERT INTO alerts (user_id, kind, text, link, created_at) SELECT id, 'board_notice', ${q(`[공지사항] ${opening.title} · ${opening.author}`)}, ` +
      `'#/board/' || (SELECT MAX(id) FROM board_posts WHERE cat = 'notice' AND title = ${q(opening.title)}), ${now} FROM users WHERE id != ${q(opening.author)};`,
    `INSERT OR REPLACE INTO setup (key, done_at) VALUES ('opening_notice', ${now});`,
  ]);
  console.log("오픈 공지를 올렸어요");
}

// 오픈 글을 고쳤으면(opening.json rev) 올라간 공지의 내용을 그 판으로 한 번 바꾼다 (제작자 요청 2026-11-01: '이런 걸 할 수 있어요'를 짧게).
// 판마다 한 번만 해서, 그 뒤 길드마스터가 직접 고친 내용은 덮어쓰지 않는다
{
  const opening = JSON.parse(readFileSync("src/opening.json", "utf8"));
  const rev = Number(opening.rev ?? 1);
  const key = `opening_notice_rev${rev}`;
  if (rev > 1 && !queryFirst(`SELECT 1 AS done FROM setup WHERE key = '${key}'`)) {
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    runSql([
      `UPDATE board_posts SET body = ${q(opening.body)} WHERE id = (SELECT MIN(id) FROM board_posts WHERE cat = 'notice' AND title = ${q(opening.title)});`,
      `INSERT OR REPLACE INTO setup (key, done_at) VALUES ('${key}', ${Date.now()});`,
    ]);
    console.log(`오픈 공지 내용을 ${rev}판으로 고쳤어요`);
  }
}
