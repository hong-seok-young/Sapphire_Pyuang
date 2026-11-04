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
  ["listings", "side", "TEXT NOT NULL DEFAULT 'sell'"],
  ["gd_avail", "confirmed_at", "INTEGER"],
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

// 길드 던전 파티는 미리 짜 주지 않는다 (제작자 2026-11-03 '파티 미리 짜 주지 말자, 사용 좀 해 보라고' -> '아니다 냅두자' -> '아니다 그냥 파티 다 없애고 공지 후 공개 이딴 거 없애고
// 직접 만들게 하자, 깔끔하게'): 11/3 에 세팅 스크립트(gd-seed.mjs, 지금은 없음)로 만든 것을 포함해 **파티를 모두** 지우고(파티·파티원·대답), 길드 던전 알림도 모두 지운다
// (파티가 없어졌으니 '팀에 들어왔어요', '명단이 열렸어요' 같은 알림은 모두 지난 것). 시간표(gd_avail)는 각자 것이라 그대로. 공지 전 숨김 스위치('gd_parties_open')와 세팅 표시도 뺀다.
// setup 'gd_reset_20261103' 로 한 번만 돈다 (그 뒤 길드원이 직접 만든 파티는 건드리지 않는다)
// 길드 던전의 한 주를 목 10:00 에서 목 10:30 으로 옮겼다 (제작자 2026-11-03 게임 스샷: 입장 횟수 초기화 목 10:30). 이미 칠한 시간표의 주 키(week)를 30분 뒤로 옮기고
// 칸도 한 칸 당긴다 (같은 절대 시각을 가리키게: 새 0번 칸 = 옛 1번 칸). 한 번만 (setup 'gd_week_1030')
runSql([
  "UPDATE gd_avail SET week = week + 1800000, slots = substr(slots, 2) || '0' WHERE NOT EXISTS (SELECT 1 FROM setup WHERE key = 'gd_week_1030');",
  `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('gd_week_1030', ${Date.now()});`,
]);
const GD_RESET = "gd_reset_20261103";
runSql([
  `DELETE FROM gd_answers WHERE NOT EXISTS (SELECT 1 FROM setup WHERE key = '${GD_RESET}');`,
  `DELETE FROM gd_members WHERE NOT EXISTS (SELECT 1 FROM setup WHERE key = '${GD_RESET}');`,
  `DELETE FROM gd_parties WHERE NOT EXISTS (SELECT 1 FROM setup WHERE key = '${GD_RESET}');`,
  `DELETE FROM alerts WHERE kind = 'gdungeon' AND NOT EXISTS (SELECT 1 FROM setup WHERE key = '${GD_RESET}');`,
  "DELETE FROM setup WHERE key LIKE 'gd_seed_%' OR key = 'gd_parties_open';",
  `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${GD_RESET}', ${Date.now()});`,
]);

// 챗봇 개선 완료를 배포가 대신 누른다 (제작자 2026-11-03 '개선완료도 너가 보내': 여기서는 실서비스 화면에 로그인할 수 없어서). functions/api/chat/gaps/[id].ts 와 같은 일:
// '밀가루' 질문의 열린 항목을 완료로 바꾸고 물어본 사람에게 '챗봇이 개선됐어요' 알림(누르면 그 대화에서 다시 묻기). setup 'gap_fix_flour_20261103' 로 한 번만.
// 알림 설정을 끈 사람에게는 안 넣는다 (notify 와 같다). 폰 알림(푸시)은 서버가 아니라서 안 간다. 실행 기록에는 개수만
{
  const KEY = "gap_fix_flour_20261103";
  const WHERE = `g.status = 'open' AND (g.question LIKE '%밀가루%' OR g.reason LIKE '%밀가루%') AND NOT EXISTS (SELECT 1 FROM setup WHERE key = '${KEY}')`;
  const n = queryFirst(`SELECT COUNT(*) AS n FROM chat_gaps g WHERE ${WHERE}`)?.n ?? 0;
  const now = Date.now();
  runSql([
    "INSERT INTO alerts (user_id, kind, text, link, created_at) " +
      "SELECT g.user_id, 'chat_fixed', '챗봇이 개선됐어요. 물어봤던 “' || substr(replace(replace(g.question, char(10), ' '), char(13), ' '), 1, 40) || '” · 이벤트 글을 끝까지 읽고 답해요', " +
      "CASE WHEN EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = g.thread_id AND t.user_id = g.user_id) THEN '#/chat/' || g.thread_id || '?again=' || g.id ELSE '#/chat' END, " +
      `${now} FROM chat_gaps g WHERE ${WHERE} AND COALESCE((SELECT p.enabled FROM alert_prefs p WHERE p.user_id = g.user_id AND p.kind = 'chat_fixed'), 1) = 1;`,
    `UPDATE chat_gaps SET status = 'fixed', note = '공식 이벤트 글을 끝까지 읽고 답하게 고침', fixed_at = ${now} WHERE id IN (SELECT g.id FROM chat_gaps g WHERE ${WHERE});`,
    `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
  ]);
  console.log(`챗봇 개선 완료(밀가루 질문) ${n}건`);
}

// 길드 던전 시간표 '확정'을 모두 푼다 (제작자 2026-11-04 '확정이 다 풀리게 해 주고 다시 확정하라고 안내'): 파티원 카드가 '입력 전 / 확정'으로 바뀌면서
// 확정을 서버(gd_avail.confirmed_at)에 적게 됐는데, 그전에 누른 확정은 폰에만 남아 있었다. 파티에 든 사람에게 다시 확정하라는 알림(gdungeon, 끈 사람 빼고).
// 폰 알림(푸시)은 서버가 아니라서 안 간다. setup 'gd_confirm_reset_20261104' 로 한 번만, 실행 기록에는 개수만
{
  const KEY = "gd_confirm_reset_20261104";
  const NOT_DONE = `NOT EXISTS (SELECT 1 FROM setup WHERE key = '${KEY}')`;
  const n = queryFirst(`SELECT COUNT(*) AS n FROM gd_members m WHERE ${NOT_DONE}`)?.n ?? 0;
  const now = Date.now();
  runSql([
    `UPDATE gd_avail SET confirmed_at = NULL WHERE confirmed_at IS NOT NULL AND ${NOT_DONE};`,
    "INSERT INTO alerts (user_id, kind, text, link, created_at) " +
      "SELECT m.user_id, 'gdungeon', '[' || p.leader || ' 팀] 시간표 확정이 풀렸어요 · 내 시간표를 보고 다시 확정을 눌러 주세요 (파티원 카드에 확정으로 보여요)', '#/match', " +
      `${now} FROM gd_members m JOIN gd_parties p ON p.id = m.party_id WHERE ${NOT_DONE} ` +
      "AND COALESCE((SELECT a.enabled FROM alert_prefs a WHERE a.user_id = m.user_id AND a.kind = 'gdungeon'), 1) = 1;",
    `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
  ]);
  console.log(`길드 던전 확정 풀기 · 다시 확정 알림 ${n}명`);
}

// 길드 던전 시간표를 요일대로 다음 주 줄에 옮겨 적는다 (제작자 2026-11-04 '사람들이 입력해 놓은 거 월화수목금토일만 맞춰서 다 다시 적어 놔, 날짜는 신경 쓰지 말고 요일만 맞춰서'):
// 열을 월 ~ 일, 날짜는 오늘부터 7일로 바꾸자 오늘(수 11/4)을 뺀 요일이 모두 다음 게임 주(목 11/5 10:30 ~) 칸이 되어, 이번 주 줄(목 10/29 10:30 ~)에 칠해 둔 시간이 안 보였다.
// 이번 주 줄의 칸마다 7일 뒤 같은 요일·시각 칸(같은 칸 번호)에 더한다 (다음 주 줄에 이미 칠한 칸은 그대로 두고 합친다, 확정도 이어 간다). 이번 게임 주 안에서 한 번만,
// setup 'gd_cols_carry_20261104'. 옮기는 동안 그 사람이 다음 주 칸을 고쳤으면 그 사람은 건너뛴다. 실행 기록에는 개수만
{
  const KEY = "gd_cols_carry_20261104";
  const W = Date.parse("2026-10-29T10:30:00+09:00");
  const NEXT = W + 7 * 86_400_000;
  if (Date.now() < NEXT && !queryFirst(`SELECT 1 AS done FROM setup WHERE key = '${KEY}'`)) {
    const all = (sql) => parseJson(wrangler("d1", "execute", DB, "--remote", "--json", "--command", sql))[0]?.results ?? [];
    const rows = all(`SELECT user_id, week, slots, confirmed_at FROM gd_avail WHERE week IN (${W}, ${NEXT})`);
    const next = new Map(rows.filter((r) => r.week === NEXT).map((r) => [r.user_id, r]));
    const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
    const now = Date.now();
    const lines = [];
    for (const r of rows) {
      if (r.week !== W || !String(r.slots).includes("1")) continue;
      const old = next.get(r.user_id);
      const had = String(old?.slots ?? "").padEnd(336, "0");
      const merged = Array.from({ length: 336 }, (_, i) => (r.slots[i] === "1" || had[i] === "1" ? "1" : "0")).join("");
      if (old && merged === old.slots) continue;
      const confirmed = r.confirmed_at == null ? "NULL" : Number(r.confirmed_at);
      lines.push(
        old
          ? `UPDATE gd_avail SET slots = '${merged}', updated_at = ${now}, confirmed_at = COALESCE(confirmed_at, ${confirmed}) WHERE user_id = ${q(r.user_id)} AND week = ${NEXT} AND slots = '${old.slots}';`
          : `INSERT OR IGNORE INTO gd_avail (user_id, week, slots, updated_at, confirmed_at) VALUES (${q(r.user_id)}, ${NEXT}, '${merged}', ${now}, ${confirmed});`,
      );
    }
    runSql([...lines, `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`]);
    console.log(`길드 던전 시간표 요일대로 다음 주 칸에 옮김 ${lines.length}명`);
  }
}

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

// 확률 시뮬레이터를 테스트판과 개발 중판으로 나눈다 (제작자 2026-11-04 '지금 시뮬레이터에 있는 거를 나만 보이는 테스트 버튼으로, 똑같은 버튼을 개발 중으로 하나 더,
// 거기는 내가 플레이한 데이터 다 초기화해서 아무도 안 한 깨끗한 버전으로'): 지금까지의 시뮬레이터 자료(sim_records·wallet·earn·feed·unlocks)를 테스트판 표(sim_t_*)로 옮기고
// 개발 중판 표는 비운다 (지우지 않고 옮긴다). setup 'sim_split_20261104' 로 한 번만. 실행 기록에는 수만
if (!queryFirst("SELECT 1 AS done FROM setup WHERE key = 'sim_split_20261104'")) {
  const count = (t) => Number(queryFirst(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0);
  const moved = ["records", "wallet", "earn", "feed", "unlocks"].map((t) => `${t} ${count(`sim_${t}`)}`).join(", ");
  runSql([
    "INSERT OR IGNORE INTO sim_t_records SELECT * FROM sim_records;",
    "INSERT OR IGNORE INTO sim_t_wallet SELECT * FROM sim_wallet;",
    "INSERT OR IGNORE INTO sim_t_earn SELECT * FROM sim_earn;",
    "INSERT INTO sim_t_feed (user_id, game, label, luck, at) SELECT user_id, game, label, luck, at FROM sim_feed;",
    "INSERT OR IGNORE INTO sim_t_unlocks SELECT * FROM sim_unlocks;",
    "DELETE FROM sim_records;",
    "DELETE FROM sim_wallet;",
    "DELETE FROM sim_earn;",
    "DELETE FROM sim_feed;",
    "DELETE FROM sim_unlocks;",
    "DELETE FROM sim_state;",
    `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('sim_split_20261104', ${Date.now()});`,
  ]);
  console.log(`시뮬레이터 자료를 테스트판으로 옮기고 개발 중판을 비웠어요 (${moved})`);
}

// 개발 중 칸을 누가 열어 봤는지 한 번 살펴 앱개발자에게 알린다 (제작자 2026-11-04 '오피서나 길마가 지금 개발 중인 거 본 사람 있나, 길드원도 들어가길 시도한 사람 있나').
// 사용 기록(DB 1 의 예전 activity 와 사용 기록 DB 2~10)에서 화면 '#/trend'·'#/enhance'·'#/sim' 을 본 줄을 사람(본캐로 묶음)마다 센다.
// 볼 수 있는 사람(시세 동향·강화 비교는 길마·오피서, 확률 시뮬레이터는 앱개발자만)과 막힌 화면('개발 중이에요')만 본 사람을 나눈다.
// 앱개발자와 테스트 계정은 뺀다. 공개 실행 기록에는 수만 찍고 닉네임은 앱개발자 알림으로. setup 'devpeek_20261104' 로 한 번만
{
  const KEY = "devpeek_20261104";
  if (!queryFirst(`SELECT 1 AS done FROM setup WHERE key = '${KEY}'`)) {
    const all = (db, sql) => {
      try {
        return parseJson(wrangler("d1", "execute", db, "--remote", "--json", "--command", sql))[0]?.results ?? [];
      } catch {
        return [];
      }
    };
    const SQL =
      "SELECT user_id, CASE WHEN what LIKE '#/trend%' THEN 'trend' WHEN what LIKE '#/enhance%' THEN 'enhance' ELSE 'sim' END AS page, " +
      "COUNT(*) AS n, MIN(at) AS first, MAX(at) AS last FROM activity WHERE kind = 'view' AND (what LIKE '#/trend%' OR what LIKE '#/enhance%' OR what LIKE '#/sim%') " +
      "GROUP BY user_id, page";
    const rows = [DB, ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `sapphire-log-${n}`)].flatMap((db) => all(db, SQL));
    const users = new Map(all(DB, "SELECT id, role, main_id FROM users").map((u) => [u.id, u]));
    const RANK = { member: 0, officer: 1, master: 2, developer: 3 };
    const ownerOf = (id) => users.get(id)?.main_id || id;
    const topRole = new Map();
    for (const u of users.values()) {
      const o = ownerOf(u.id);
      if ((RANK[u.role] ?? 0) >= (RANK[topRole.get(o)] ?? -1)) topRole.set(o, u.role);
    }
    const NAME = { trend: "시세 동향", enhance: "강화 비교", sim: "확률 시뮬레이터" };
    const kst = (ms) => {
      const d = new Date(Number(ms) + 9 * 3_600_000);
      return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    };
    // 사람·화면마다 합친다 (같은 사람의 캐릭터와 여러 DB 의 줄)
    const by = new Map();
    for (const r of rows) {
      const o = ownerOf(r.user_id);
      const role = topRole.get(o) ?? users.get(r.user_id)?.role;
      if (role === "developer" || ["테스트1", "테스트2"].includes(r.user_id) || !users.has(r.user_id)) continue;
      const k = `${o}\t${r.page}`;
      const g = by.get(k) ?? { who: o, page: r.page, role, n: 0, first: Infinity, last: 0, chars: new Set() };
      g.n += Number(r.n);
      g.first = Math.min(g.first, Number(r.first));
      g.last = Math.max(g.last, Number(r.last));
      if (r.user_id !== o) g.chars.add(r.user_id);
      by.set(k, g);
    }
    const allowed = (g) => g.page !== "sim" && (RANK[g.role] ?? 0) >= 1;
    const line = (g) => `${g.who}${g.chars.size ? `(${[...g.chars].join("·")})` : ""} ${NAME[g.page]} ${g.n}번 (${kst(g.first)}${g.n > 1 ? ` ~ ${kst(g.last)}` : ""})`;
    const list = [...by.values()].sort((a, b) => a.first - b.first);
    const saw = list.filter(allowed);
    const blocked = list.filter((g) => !allowed(g));
    const text =
      "개발 중 칸 열어 본 사람 · " +
      (saw.length ? `본 운영진: ${saw.map(line).join(", ")}` : "본 운영진 없음") +
      " · " +
      (blocked.length ? `막힌 화면('개발 중이에요')을 본 사람: ${blocked.map((g) => `${line(g)}${g.role === "member" ? "" : " [운영진]"}`).join(", ")}` : "막힌 화면을 본 사람 없음");
    const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
    const devs = [...users.values()].filter((u) => u.role === "developer").map((u) => u.id);
    const now = Date.now();
    runSql([
      ...devs.map((id) => `INSERT INTO alerts (user_id, kind, text, link, created_at) VALUES (${q(id)}, 'account', ${q(text)}, '#/log', ${now});`),
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
    ]);
    const people = (xs) => new Set(xs.map((g) => g.who)).size;
    console.log(
      `개발 중 칸: 본 운영진 ${people(saw)}명 (${saw.map((g) => `${NAME[g.page]} ${g.n}번`).join(", ") || "-"}), ` +
        `막힌 화면을 본 길드원 ${people(blocked.filter((g) => g.role === "member"))}명, 운영진 ${people(blocked.filter((g) => g.role !== "member"))}명 (${blocked.map((g) => NAME[g.page]).join(", ") || "-"}). 닉네임은 앱개발자 알림으로`,
    );
  }
}
