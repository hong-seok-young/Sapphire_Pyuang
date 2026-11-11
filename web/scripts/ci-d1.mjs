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
import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { CONTROL_CARD_KEY, CONTROL_KEY, controlCardSql, controlNoticeSql } from "./controlNotice.mjs";

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
  ["gc_items", "info", "TEXT"],
  ["gc_items", "gold", "INTEGER"],
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
  // 건의함 익명 글·댓글 (2026-11-09, server/board.ts)
  ["board_posts", "anon", "INTEGER NOT NULL DEFAULT 0"], ["board_comments", "anon", "INTEGER NOT NULL DEFAULT 0"],
  ["donate_items", "options", "TEXT"], ["donate_items", "enchant", "TEXT"],
  ["board_posts", "sg_status", "TEXT"],
  // 폰 알림을 마지막으로 보낸 때와 푸시 서버의 답 (server/push.ts pushOne, 어느 폰이 안 받는지 보려고)
  ["push_subs", "last_status", "INTEGER"], ["push_subs", "last_at", "INTEGER"],
  // 성장코인샵 목표를 정할 때 경험치: 그 자리가 달성률 0% (제작자 2026-11-11)
  ["gc_targets", "from_exp", "INTEGER"],
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

// 개발 요청을 열었다가 다시 개발 중으로 내렸다 (제작자 2026-11-05 '아직 개발중으로 내려'): 그때 모두에게 간 새 기능 알림(app_news, #/devreq)을 지운다.
// 예전 코드가 아직 돌고 있어도 다시 보내지 않게 그 알림의 setup 키(app_news_devreq_20261105)를 먼저 적는다. 폰에 이미 뜬 알림은 거둘 수 없다. 실행 기록에는 개수만
{
  const KEY = "app_news_devreq_undo_20261105";
  const now = Date.now();
  runSql([`INSERT OR IGNORE INTO setup (key, done_at) VALUES ('app_news_devreq_20261105', ${now});`]);
  const NOT_DONE = `NOT EXISTS (SELECT 1 FROM setup WHERE key = '${KEY}')`;
  const n = queryFirst(`SELECT COUNT(*) AS n FROM alerts WHERE kind = 'app_news' AND link = '#/devreq' AND ${NOT_DONE}`)?.n ?? 0;
  runSql([
    `DELETE FROM alerts WHERE kind = 'app_news' AND link = '#/devreq' AND ${NOT_DONE};`,
    `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
  ]);
  console.log(`개발 요청 새 기능 알림 지움 ${n}건`);
}

// 개발 요청 예시 3개 (제작자 2026-11-05 '길마가 볼 수 있게 오피서 확인 전까지 / 오피서 합의한 거 / 오피서 반려한 거 가상 데이터 넣어 줘'):
// 길마가 '합의 생략 결재' · '최종 결재' · '강제 결재'를 직접 눌러 볼 수 있게. 신청한 사람은 튜토리얼 예시와 같은 '길잡이', 오피서는 '예시오피서'(실제 계정이 아니다),
// 글 앞에 [예시]. 개발자 검토는 퓨앙이 '개발 가능'으로. 알림은 보내지 않는다. 앱개발자가 개발 요청 화면에서 지울 수 있다. setup 'devreq_samples_20261105' 로 한 번만
{
  const KEY = "devreq_samples_20261105";
  const NOT_DONE = `NOT EXISTS (SELECT 1 FROM setup WHERE key = '${KEY}')`;
  const now = Date.now();
  const H = 3_600_000;
  const samples = [
    { body: "[예시] 홈에 오늘 보스 젠 시간 모아 보기", scope: "all", status: "agree", steps: [] },
    { body: "[예시] 길드 랭킹에 지난주 성장 1등 표시", scope: "all", status: "agree", steps: [["예시오피서", "agree", "랭킹 맨 위에 작게 넣으면 좋겠어요"]] },
    { body: "[예시] 중개인 물건을 이름순으로 정렬", scope: "me", status: "rejected", steps: [["예시오피서", "reject", "지금 정렬로도 충분해요"]] },
  ];
  const q = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
  const lines = [];
  samples.forEach((x, i) => {
    const t0 = now - (3 - i) * H;
    const id = `(SELECT id FROM dev_requests WHERE body = ${q(x.body)} ORDER BY id DESC LIMIT 1)`;
    lines.push(
      `INSERT INTO dev_requests (user_id, body, scope, people, status, round, created_at, updated_at) SELECT '길잡이', ${q(x.body)}, '${x.scope}', NULL, '${x.status}', 1, ${t0}, ${t0 + 30 * 60_000} WHERE ${NOT_DONE};`,
      `INSERT INTO dev_request_steps (req_id, round, user_id, kind, note, created_at) SELECT ${id}, 1, '길잡이', 'submit', NULL, ${t0} WHERE ${NOT_DONE};`,
      `INSERT INTO dev_request_steps (req_id, round, user_id, kind, note, created_at) SELECT ${id}, 1, '퓨앙', 'feasible', '만들 수 있어요', ${t0 + 10 * 60_000} WHERE ${NOT_DONE};`,
      ...x.steps.map(
        ([who, kind, note]) =>
          `INSERT INTO dev_request_steps (req_id, round, user_id, kind, note, created_at) SELECT ${id}, 1, ${q(who)}, '${kind}', ${q(note)}, ${t0 + 30 * 60_000} WHERE ${NOT_DONE};`,
      ),
    );
  });
  const fresh = !queryFirst(`SELECT 1 AS x FROM setup WHERE key = '${KEY}'`);
  runSql([...lines, `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`]);
  console.log(fresh ? "개발 요청 예시 3개 넣음" : "개발 요청 예시는 이미 넣었어요");
}

// 확률 시뮬레이터 개발 중판(sim_wallet, 테스트판 sim_t_wallet 아님)에 유어아너만 행운 코인 10000 을 더한다 (제작자 2026-11-05 '유어아너만 10000 코인 넣어줘 개발중에').
// 지갑이 아직 없으면 처음 코인(100)에 더해 만든다. 계정이 있을 때만, 알림은 보내지 않는다. setup 'sim_gift_youarehonor_20261105' 로 한 번만
{
  const KEY = "sim_gift_youarehonor_20261105";
  const WHO = "유어아너";
  const now = Date.now();
  const NOT_DONE = `NOT EXISTS (SELECT 1 FROM setup WHERE key = '${KEY}')`;
  const has = queryFirst(`SELECT COUNT(*) AS n FROM users WHERE id = '${WHO}' AND ${NOT_DONE}`)?.n ?? 0;
  runSql([
    `INSERT INTO sim_wallet (user_id, coins, earned, spent, updated_at) SELECT '${WHO}', 100 + 10000, 10000, 0, ${now} ` +
      `WHERE EXISTS (SELECT 1 FROM users WHERE id = '${WHO}') AND ${NOT_DONE} ` +
      `ON CONFLICT(user_id) DO UPDATE SET coins = coins + 10000, earned = earned + 10000, updated_at = ${now};`,
    `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
  ]);
  console.log(`시뮬레이터 코인 10000 넣음 ${has}명`);
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
// 장비대여 담당자 오픈채팅 링크 (제작자 2026-11-10 '멍멍 오픈채팅 이걸로 링크 연결해', 장비대여 안내 pages/RentNotice.tsx): 사람의 연락처라 공개 저장소에 적지 않고
// 비공개 자료 길드/장비대여/담당자_오픈채팅.txt('닉네임 링크' 한 줄씩)를 그 계정의 카톡 링크(users.kakao: 안내 창·전광판·'담당자 카톡' 단추가 쓴다)로 넣는다.
// 링크마다 한 번 (setup 'kakao_link_<닉네임>_<링크 해시>'): 그 뒤 본인이 '내 정보'에서 바꾼 것은 덮지 않고, 파일의 링크를 바꾸면 한 번 더 넣는다. 계정이 아직 없으면 다음 배포에. 실행 기록에는 개수만
{
  const file = "../자료/길드/장비대여/담당자_오픈채팅.txt";
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  if (existsSync(file)) {
    let n = 0;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.trim().match(/^([^\s#]+)\s+(https:\/\/open\.kakao\.com\/(?:o|me)\/[A-Za-z0-9_-]{4,40})\/?$/);
      if (!m) continue;
      const [, id, link] = m;
      const key = `kakao_link_${id}_${createHash("sha256").update(link).digest("hex").slice(0, 10)}`;
      if (queryFirst(`SELECT 1 AS done FROM setup WHERE key = ${q(key)}`)) continue;
      if (!queryFirst(`SELECT 1 AS x FROM users WHERE id = ${q(id)}`)) continue;
      runSql([`UPDATE users SET kakao = ${q(link)} WHERE id = ${q(id)};`, `INSERT OR IGNORE INTO setup (key, done_at) VALUES (${q(key)}, ${Date.now()});`]);
      n++;
    }
    if (n) console.log(`장비대여 담당자 오픈채팅 링크를 넣었어요 (${n})`);
  }
}

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

// 아이모 소식 글의 본 사람을 지금까지의 사용 기록으로 채운다 (제작자 2026-11-06 '아이모 소식에서도 조회수 댓글 등등, 혹시 지금까지 조회한 거 기록 있으면 반영해 주고').
// 사용 기록(DB 1 의 예전 activity 와 사용 기록 DB 2~10)의 화면 '#/official/<글>' 줄을 글·사람마다 처음 본 때로 official_views 에 (이미 있으면 그대로).
// 테스트 계정은 뺀다. 공개 실행 기록에는 수만. setup 'official_views_backfill' 로 한 번만
{
  const KEY = "official_views_backfill";
  if (!queryFirst(`SELECT 1 AS done FROM setup WHERE key = '${KEY}'`)) {
    const all = (db, sql) => {
      try {
        return parseJson(wrangler("d1", "execute", db, "--remote", "--json", "--command", sql))[0]?.results ?? [];
      } catch {
        return [];
      }
    };
    const SQL = "SELECT what, user_id, MIN(at) AS at FROM activity WHERE kind = 'view' AND what LIKE '#/official/%' GROUP BY what, user_id";
    const rows = [DB, ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `sapphire-log-${n}`)].flatMap((db) => all(db, SQL));
    const posts = new Set(all(DB, "SELECT id FROM official_news").map((r) => Number(r.id)));
    const users = new Set(all(DB, "SELECT id FROM users").map((r) => r.id));
    const first = new Map();
    for (const r of rows) {
      const m = /^#\/official\/(\d+)/.exec(String(r.what));
      if (!m || ["테스트1", "테스트2"].includes(r.user_id) || !users.has(r.user_id)) continue;
      const id = Number(m[1]);
      if (!posts.has(id)) continue;
      const k = `${id}\t${r.user_id}`;
      first.set(k, Math.min(first.get(k) ?? Infinity, Number(r.at)));
    }
    const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
    const lines = [...first].map(([k, at]) => {
      const [id, user] = k.split("\t");
      return `INSERT INTO official_views (post_id, user_id, at) VALUES (${id}, ${q(user)}, ${at}) ON CONFLICT (post_id, user_id) DO NOTHING;`;
    });
    const now = Date.now();
    for (let i = 0; i < lines.length; i += 500) runSql(lines.slice(i, i + 500));
    runSql([`INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`]);
    console.log(`아이모 소식 본 사람 채움: ${first.size}줄 (글 ${new Set([...first.keys()].map((k) => k.split("\t")[0])).size}개)`);
  }
}

// 생일 콤보 2140 (제작자 2026-11-08 '백돼쥐 2140 까지 했는데 반영 안 됐대, 순위에 2140 으로 반영'): 콤보 상한(MAX_COMBO 2000)에 걸려 서버가 받지 않았다.
// 상한을 올리고 그 기록을 한 번 넣는다 (더 높은 기록이 있으면 그대로). 계정이 있을 때만, setup 'bday_fix_2140_20261108' 로 한 번만, 실행 기록에는 수만
{
  const KEY = "bday_fix_2140_20261108";
  const WHO = "백돼쥐";
  const now = Date.now();
  const NOT_DONE = `NOT EXISTS (SELECT 1 FROM setup WHERE key = '${KEY}')`;
  const has = queryFirst(`SELECT COUNT(*) AS n FROM users WHERE id = '${WHO}' AND ${NOT_DONE}`)?.n ?? 0;
  runSql([
    `INSERT INTO bday_combo (bday, user_id, best, at) SELECT 'village-2026', '${WHO}', 2140, ${now} ` +
      `WHERE EXISTS (SELECT 1 FROM users WHERE id = '${WHO}') AND ${NOT_DONE} ` +
      `ON CONFLICT (bday, user_id) DO UPDATE SET best = excluded.best, at = excluded.at WHERE bday_combo.best < excluded.best;`,
    `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
  ]);
  console.log(`생일 콤보 기록 넣음 ${has}명`);
}

// 생일 콤보 이어서 하기 (제작자 2026-11-08 '쿨쿨 쿠루미는 억울하게 끊겼으니까 11700 에서 이어서 할 수 있게, 그 사람 웹 들어가면 이어서 하기 버튼'):
// 그 사람에게 bday_resume 한 줄 (화면이 스티커 위에 '11,700 콤보 이어서 하기' 단추를 띄운다)과 순위에 11700 (더 높은 기록이 있으면 그대로).
// 닉네임은 띄어쓰기가 있을 수도 없을 수도 있어 둘 다 본다. 계정이 있을 때만, setup 'bday_resume_kurumi_20261108' 로 한 번만, 실행 기록에는 수만
{
  const KEY = "bday_resume_kurumi_20261108";
  const WHO = ["쿨쿨쿠루미", "쿨쿨 쿠루미"].map((w) => `'${w}'`).join(", ");
  const now = Date.now();
  const NOT_DONE = `NOT EXISTS (SELECT 1 FROM setup WHERE key = '${KEY}')`;
  const has = queryFirst(`SELECT COUNT(*) AS n FROM users WHERE id IN (${WHO}) AND ${NOT_DONE}`)?.n ?? 0;
  runSql([
    `INSERT INTO bday_resume (bday, user_id, combo, created_at) SELECT 'village-2026', id, 11700, ${now} FROM users WHERE id IN (${WHO}) AND ${NOT_DONE} ` +
      `ON CONFLICT (bday, user_id) DO UPDATE SET combo = excluded.combo, created_at = excluded.created_at, used_at = NULL;`,
    `INSERT INTO bday_combo (bday, user_id, best, at) SELECT 'village-2026', id, 11700, ${now} FROM users WHERE id IN (${WHO}) AND ${NOT_DONE} ` +
      `ON CONFLICT (bday, user_id) DO UPDATE SET best = excluded.best, at = excluded.at WHERE bday_combo.best < excluded.best;`,
    `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
  ]);
  console.log(`생일 콤보 이어서 하기 넣음 ${has}명`);
}

// 2군 성장코인샵 (server/gcoin.ts, 개발중): 코인을 세기 시작한 때(setup 'gcoin_start', 처음 배포 때 한 번)와 기본값.
// 레벨업 코인표·물건은 표가 비어 있을 때만, 순위 보너스는 없을 때만 넣는다 (오피서가 고친 값은 덮지 않는다). server/gcoin.ts 의 DEFAULT_* 와 같다
{
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const now = Date.now();
  const LEVELS = [[1, 0], [21, 10], [26, 15], [31, 40], [34, 40], [36, 50], [37, 80], [38, 100], [39, 120], [45, 150]];
  const ITEMS = [
    ["사나운 멧돼지 인형", "20개", 120, null],
    ["망고워터", "20개", 35, "쿨타임 60초 · 20분 동안 지속: 크리티컬 4 증가"],
    ["자몽주스", "50개", 60, "쿨타임 5초"],
    ["자몽케이크", "50개", 80, "쿨타임 5초"],
    ["우파우파의노래", "20개", 0, null],
    ["잠깬쿠이인형", "20개", 0, "쿨타임 5초 · 20분 동안 지속: 데미지 20% 증가"],
    ["별과자", "20개", 0, "쿨타임 5초 · 20분 동안 지속: 크리티컬 5 증가"],
    ["동그리사탕", "20개", 0, null],
    ["데블랑사탕", "20개", 0, "쿨타임 5초 · 20분 동안 지속: 크리티컬 5 증가"],
    ["딸기빙수", "20개", 0, null],
    ["꿀사과", "20개", 0, null],
    ["알사탕", "20개", 0, null],
    ["자라의노래", "20개", 0, "쿨타임 5초 · 20분 동안 지속: 경험치 30% 증가"],
  ];
  const RANK = [5, 4, 3, 2, 1];
  const lines = [`INSERT OR IGNORE INTO setup (key, done_at) VALUES ('gcoin_start', ${now});`];
  if (!queryFirst("SELECT 1 AS x FROM gc_levels")) for (const [lv, c] of LEVELS) lines.push(`INSERT INTO gc_levels (min_level, coin) VALUES (${lv}, ${c});`);
  if (!queryFirst("SELECT 1 AS x FROM gc_items"))
    ITEMS.forEach(([n, u, p, info], i) => lines.push(`INSERT INTO gc_items (name, unit, price, info, active, sort) VALUES (${q(n)}, ${q(u)}, ${p}, ${info ? q(info) : "NULL"}, 1, ${i});`));
  RANK.forEach((v, i) => lines.push(`INSERT OR IGNORE INTO gc_settings (key, value) VALUES ('rank${i + 1}', ${v});`));
  runSql(lines);
  console.log("2군 성장코인샵 기본값 (비어 있을 때만)");
}

// 성장코인 Lv.31~33 레벨당 35 -> 39 (제작자 2026-11-09 '30에서 32 찍으면 사멧 10개 망고워터 10개 살 코인 수준': 39 x 2 = 78 = 60 + 18).
// 처음 넣은 값(35) 그대로일 때만 바꾼다 (오피서가 고친 값은 그대로). setup 'gcoin_lv31_39_20261109' 로 한 번만
{
  const KEY = "gcoin_lv31_39_20261109";
  const now = Date.now();
  runSql([
    `UPDATE gc_levels SET coin = 39 WHERE min_level = 31 AND coin = 35 AND NOT EXISTS (SELECT 1 FROM setup WHERE key = '${KEY}');`,
    `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
  ]);
}

// 성장코인 Lv.31~33 레벨당 39 -> 40 (제작자 2026-11-09 '경험치 % 마다 딱 떨어지는 단위로 잘게 쪼개': 39 는 어느 % 로도 안 나눠져 레벨업 때 한꺼번에만 줄 수 있다.
// 40 이면 2.5% 마다 1개, 30 -> 32 는 80 이라 사멧 10개 + 망고워터 10개(78)도 그대로). 39 그대로일 때만, setup 'gcoin_lv31_40_20261109' 로 한 번만
{
  const KEY = "gcoin_lv31_40_20261109";
  runSql([
    `UPDATE gc_levels SET coin = 40 WHERE min_level = 31 AND coin = 39 AND NOT EXISTS (SELECT 1 FROM setup WHERE key = '${KEY}');`,
    `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${Date.now()});`,
  ]);
}

// 성장코인샵 물건 (제작자 2026-11-09 '자몽주스와 자몽케이크는 50개 단위, 나머지는 20개, 이미지 이거 써' -> '누르면 옵션 보여 줘, 스샷 골드 가격 무시해,
// 골드 값어치는 관리자가 쓸 거야'): 처음 물건(사나운 멧돼지 10개·20개 …)을 지우고 거래소 스샷의 물건 15개로 바꾼다. 값은 제작자가 처음 준 넷만, 나머지는 0(값 정하기 전),
// 옵션은 스샷 정보창에 보인 것. 아직 개발 중이라 관리자가 고친 물건이 없다. setup 'gcoin_items_v3_20261109' 로 한 번만 (그 전 판 'gcoin_items_tong_20261109' 는 스샷 값을 넣었다)
{
  const KEY = "gcoin_items_v3_20261109";
  if (!queryFirst(`SELECT 1 AS x FROM setup WHERE key = '${KEY}'`)) {
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    const ITEMS = [
      ["사나운 멧돼지 인형", "20개", 120, null],
      ["망고워터", "20개", 35, "쿨타임 60초 · 20분 동안 지속: 크리티컬 4 증가"],
      ["자몽주스", "50개", 60, "쿨타임 5초"],
      ["자몽케이크", "50개", 80, "쿨타임 5초"],
      ["우파우파의노래", "20개", 0, null],
      ["잠깬쿠이인형", "20개", 0, "쿨타임 5초 · 20분 동안 지속: 데미지 20% 증가"],
      ["별과자", "20개", 0, "쿨타임 5초 · 20분 동안 지속: 크리티컬 5 증가"],
      ["동그리사탕", "20개", 0, null],
      ["데블랑사탕", "20개", 0, "쿨타임 5초 · 20분 동안 지속: 크리티컬 5 증가"],
      ["딸기빙수", "20개", 0, null],
      ["꿀사과", "20개", 0, null],
      ["알사탕", "20개", 0, null],
      ["자라의노래", "20개", 0, "쿨타임 5초 · 20분 동안 지속: 경험치 30% 증가"],
    ];
    runSql([
      "DELETE FROM gc_items;",
      ...ITEMS.map(([n, u, p, info], i) => `INSERT INTO gc_items (name, unit, price, info, active, sort) VALUES (${q(n)}, ${q(u)}, ${p}, ${info ? q(info) : "NULL"}, 1, ${i});`),
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${Date.now()});`,
    ]);
    console.log("성장코인샵 물건", ITEMS.length);
  }
}

// 성장코인샵 시범운영 (김다혜 2026-11-09 '1코인당 3만 골드, 사멧 10개 2코인, 자몽주스·케이크 50개당 2코인, 크4물약 20개당 1코인', '1등부터 5등만, 37렙 먼저 찍으면 5코인'):
// 사나운 멧돼지 인형은 10개 단위로, 넷의 골드 값을 그 코인만큼(3만 골드 x 코인), 나머지 물건의 코인은 골드 값으로 다시 셈한다 (1,000골드 -> 3만 골드).
// 2주 목표 선착순 상금은 1~5위 5 · 4 · 3 · 2 · 1 (예전 주간 순위 보너스 100 · 60 · 30 · 20 · 10 그대로일 때만). setup 'gcoin_trial_20261109' 로 한 번만
{
  const KEY = "gcoin_trial_20261109";
  if (!queryFirst(`SELECT 1 AS x FROM setup WHERE key = '${KEY}'`)) {
    runSql([
      "UPDATE gc_items SET unit = '10개', gold = 60000, price = 2 WHERE name = '사나운 멧돼지 인형';",
      "UPDATE gc_items SET gold = 30000, price = 1 WHERE name = '망고워터';",
      "UPDATE gc_items SET gold = 60000, price = 2 WHERE name IN ('자몽주스', '자몽케이크');",
      "UPDATE gc_items SET price = MAX(1, CAST(ROUND(gold / 30000.0) AS INTEGER)) WHERE gold > 0 AND name NOT IN ('사나운 멧돼지 인형', '망고워터', '자몽주스', '자몽케이크');",
      // 골드 칸이 생기기 전에 코인만 적은 물건(1코인 = 1,000골드 때)은 그 골드로 다시 셈한다
      "UPDATE gc_items SET gold = price * 1000, price = MAX(1, CAST(ROUND(price * 1000 / 30000.0) AS INTEGER)) WHERE gold IS NULL AND price > 0 AND name NOT IN ('사나운 멧돼지 인형', '망고워터', '자몽주스', '자몽케이크');",
      ...[[1, 100, 5], [2, 60, 4], [3, 30, 3], [4, 20, 2], [5, 10, 1]].map(([i, old, v]) => `UPDATE gc_settings SET value = ${v} WHERE key = 'rank${i}' AND value = ${old};`),
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${Date.now()});`,
    ]);
    console.log("성장코인샵 시범운영 값 (한 번)");
  }
}

// 성장코인샵 오픈 준비 (제작자 2026-11-10, 유어아너 공지 '2군 퀘스트 이벤트'): 1~5위 6 · 4 · 3 · 2 · 2, 피닉스의심장 5개 2코인(6만 골드),
// 판을 1주 진행·1주 휴식으로 바꾸며 첫 판이 11/11(수) 11:00 시작이 되어(server/gcrace.ts), 11/9 판에 정해 둔 목표는 새 첫 판으로 옮기고 오픈 전 11/9 판 상금은 지운다. setup 'gcoin_open_prep_20261110' 로 한 번만
{
  const KEY = "gcoin_open_prep_20261110";
  if (!queryFirst(`SELECT 1 AS x FROM setup WHERE key = '${KEY}'`)) {
    const OLD = 1794150000000; // 2026-11-09 00:00 KST
    const NEW = 1794362400000; // 2026-11-11 11:00 KST
    runSql([
      ...[6, 4, 3, 2, 2].map((v, i) => `INSERT INTO gc_settings (key, value) VALUES ('rank${i + 1}', ${v}) ON CONFLICT (key) DO UPDATE SET value = excluded.value;`),
      "INSERT INTO gc_items (name, unit, price, gold, active, sort) SELECT '피닉스의심장', '5개', 2, 60000, 1, (SELECT COALESCE(MAX(sort), 0) + 1 FROM gc_items) " +
        "WHERE NOT EXISTS (SELECT 1 FROM gc_items WHERE REPLACE(name, ' ', '') = '피닉스의심장');",
      `UPDATE gc_targets SET round = ${NEW} WHERE round = ${OLD} AND NOT EXISTS (SELECT 1 FROM gc_targets t WHERE t.round = ${NEW} AND t.user_id = gc_targets.user_id);`,
      `DELETE FROM gc_ledger WHERE kind = 'race' AND ref = 'race:${OLD}';`,
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${Date.now()});`,
    ]);
    console.log("성장코인샵 오픈 준비 (한 번)");
  }
}

// 성장코인샵 주간 목표 첫 판을 11/16(월) 0시부터로 (제작자 2026-11-10 '00시부터, 월요일부터야 다음 주'): 11/11 11:00 판에 정해 둔 목표·상금 장부를 새 첫 판 번호로 옮기고,
// 그 전에 정해 둔 기간(gc_rounds)은 지운다 (기본 판 11/16 0시 ~ 11/22 24시, 쉬고 11/30 …). setup 'gcoin_round_mon_20261110' 로 한 번만
{
  const KEY = "gcoin_round_mon_20261110";
  if (!queryFirst(`SELECT 1 AS x FROM setup WHERE key = '${KEY}'`)) {
    const OLD = 1794362400000; // 2026-11-11 11:00 KST
    const NEW = 1794754800000; // 2026-11-16 00:00 KST
    runSql([
      `UPDATE gc_targets SET round = ${NEW} WHERE round = ${OLD} AND NOT EXISTS (SELECT 1 FROM gc_targets t WHERE t.round = ${NEW} AND t.user_id = gc_targets.user_id);`,
      `UPDATE gc_ledger SET ref = 'race:${NEW}' WHERE kind = 'race' AND ref = 'race:${OLD}';`,
      `DELETE FROM gc_rounds WHERE start < ${NEW};`,
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${Date.now()});`,
    ]);
    console.log("성장코인샵 첫 판을 11/16(월) 0시부터 (한 번)");
  }
}

// 성장코인샵 목표를 정한 자리를 달성률 0% 로 (제작자 2026-11-11 '목표 설정하면 기존 겸치가 어떻든 그냥 달성률 0% 로 시작'): 이미 정한 목표마다
// 판이 시작한 때와 정한 때 중 늦은 때의 마지막 기록이 시작 레벨이면 그 경험치, 기록이 없으면 지금 프로필(같은 레벨일 때). setup 'gcoin_from_exp_20261111' 로 한 번만
{
  const KEY = "gcoin_from_exp_20261111";
  if (!queryFirst(`SELECT 1 AS x FROM setup WHERE key = '${KEY}'`)) {
    const at = "MAX(gc_targets.set_at, COALESCE((SELECT r.start FROM gc_rounds r WHERE r.id = gc_targets.round), gc_targets.round))";
    const last = `FROM level_log l WHERE l.user_id = gc_targets.user_id AND l.at <= ${at} ORDER BY l.at DESC LIMIT 1`;
    runSql([
      "UPDATE gc_targets SET from_exp = CASE " +
        `WHEN EXISTS (SELECT 1 ${last}) THEN COALESCE((SELECT CASE WHEN l.level = gc_targets.from_level THEN COALESCE(l.exp, 0) ELSE 0 END ${last}), 0) ` +
        "ELSE COALESCE((SELECT CASE WHEN p.level = gc_targets.from_level THEN COALESCE(p.exp, 0) ELSE 0 END FROM profiles p WHERE p.user_id = gc_targets.user_id), 0) END " +
        "WHERE from_exp IS NULL;",
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${Date.now()});`,
    ]);
    console.log("성장코인샵 목표 시작 경험치 채움 (한 번)");
  }
}

// 기부함 마일리지를 기부 골드 가치의 0.6 으로 (제작자 2026-11-10 '기부한 골드 가치의 x 0.6 이 마일리지로 쌓이는 거임, 10만 골드당 1, 소수점은 누적, 정수 부분만 사용').
// 그 전에 확정한 기부(1.0 으로 넣은 💎)를 사람마다 floor(골드 합 x 0.6 / 10만) 에 맞춰 차이를 장부에 한 줄 넣고, 그 사람의 가장 최근 기부 줄 dia 에 더한다. setup 'donate_rate_06_20261110' 로 한 번만
{
  const KEY = "donate_rate_06_20261110";
  if (!queryFirst(`SELECT 1 AS x FROM setup WHERE key = '${KEY}'`)) {
    const now = Date.now();
    const target = "(SELECT CAST(SUM(CASE WHEN x.status = 'done' THEN x.gold ELSE 0 END) * 6 / 1000000 AS INTEGER) - SUM(x.dia) FROM donate_items x WHERE x.who = %W)";
    runSql([
      `INSERT INTO rental_mileage (who, delta, reason, note, by_user, created_at) SELECT who, diff, 'donate', '기부함 · 마일리지 0.6 반영', 'system', ${now} ` +
        `FROM (SELECT d.who AS who, ${target.replace("%W", "d.who")} AS diff FROM donate_items d GROUP BY d.who) WHERE diff != 0;`,
      `UPDATE donate_items SET dia = dia + ${target.replace("%W", "donate_items.who")} WHERE id IN (SELECT MAX(id) FROM donate_items GROUP BY who);`,
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
    ]);
    console.log("기부함 마일리지 0.6 반영 (한 번)");
  }
}

// 길드원 전원 알림 설정 모두 켜기 (제작자 2026-11-10 '길드원 전원 웹 내의 알림 설정은 다 켜버려'): 알림 종류마다 끈 줄(앱 알림함·폰 알림)을 지워 처음 값으로 되돌린다.
// 처음 값은 모두 켜짐 (server/alerts.ts ALERT_KINDS, 새 물건·새 의뢰도 이때부터 켜짐). 이 폰의 폰 알림 스위치(브라우저 허락)는 폰마다라 여기서 켤 수 없다. setup 'alerts_all_on_20261110' 로 한 번만
{
  const KEY = "alerts_all_on_20261110";
  if (!queryFirst(`SELECT 1 AS x FROM setup WHERE key = '${KEY}'`)) {
    const n = queryFirst("SELECT COUNT(*) AS n FROM alert_prefs WHERE enabled = 0 OR push = 0")?.n ?? 0;
    runSql(["DELETE FROM alert_prefs;", `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${Date.now()});`]);
    console.log(`알림 설정 모두 켬 (꺼져 있던 줄 ${n}개, 한 번)`);
  }
}

// 예전 기부(기부자별 내역)로 마일리지를 받은 사람에게 알림 (제작자 2026-11-10 'ㄱ'): 장부의 '기부함 · 예전 기부…' 줄 합이 0 보다 큰 앱 계정마다 한 번 장비대여 알림.
// 폰 알림은 같은 때·종류로 push_queue 에 적어 두면 /api/news 가 40대씩 보낸다 (server/push.ts drainPushQueue). setup 'mileage_notice_old_20261110' 로 한 번만
{
  const KEY = "mileage_notice_old_20261110";
  if (!queryFirst(`SELECT 1 AS x FROM setup WHERE key = '${KEY}'`)) {
    const now = Date.now();
    const NOT_DONE = `NOT EXISTS (SELECT 1 FROM setup WHERE key = '${KEY}')`;
    runSql([
      "INSERT INTO alerts (user_id, kind, text, link, created_at) " +
        `SELECT m.who, 'rent', '[장비대여] 예전에 기부하신 것으로 마일리지가 💎' || m.n || ' 들어왔어요 · 대여 보증금으로 쓸 수 있어요', '#/rent?v=apps', ${now} ` +
        "FROM (SELECT who, SUM(delta) AS n FROM rental_mileage WHERE reason = 'donate' AND note LIKE '기부함 · 예전 기부%' GROUP BY who) m " +
        `JOIN users u ON u.id = m.who WHERE m.n > 0 AND COALESCE((SELECT p.enabled FROM alert_prefs p WHERE p.user_id = m.who AND p.kind = 'rent'), 1) = 1 AND ${NOT_DONE};`,
      `INSERT INTO push_queue (kind, created_at, last, claimed_at) SELECT 'rent', ${now}, '', NULL WHERE EXISTS (SELECT 1 FROM alerts WHERE kind = 'rent' AND created_at = ${now}) AND ${NOT_DONE};`,
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
    ]);
    const n = queryFirst(`SELECT COUNT(*) AS n FROM alerts WHERE kind = 'rent' AND created_at = ${now}`)?.n ?? 0;
    console.log(`예전 기부 마일리지 알림 ${n}명 (한 번)`);
  }
}

// 시리온 통제 리스트를 공지사항으로 (제작자 2026-11-10 '우리 길드는 중립길드야, 이 몹들을 잡으면 안 되는 통제 리스트, 길드의 공지사항에 넣어줘, 글쓴이는 사파이어로').
// 비공개 자료 길드/통제_리스트.json 과 표 그림으로 글(고정)·그림 첨부·모두에게 알림 (scripts/controlNotice.mjs). setup 'control_notice_20261110' 로 한 번만
{
  if (!queryFirst(`SELECT 1 AS x FROM setup WHERE key = '${CONTROL_KEY}'`)) {
    const now = Date.now();
    const lines = controlNoticeSql("../자료", now);
    if (!lines) console.log("통제 리스트 자료가 없어 공지를 건너뜀");
    else {
      runSql(lines);
      const n = queryFirst(`SELECT COUNT(*) AS n FROM alerts WHERE kind = 'board_notice' AND created_at = ${now}`)?.n ?? 0;
      const f = queryFirst(`SELECT COUNT(*) AS n, MAX(length(data)) AS b FROM board_files WHERE created_at = ${now}`);
      console.log(`통제 리스트 공지를 올렸어요 (알림 ${n}명, 그림 ${f?.n ?? 0}장 ${f?.b ?? 0}바이트)`);
    }
  }
  // 앱 모양의 통제 리스트 칸으로 (제작자 2026-11-10 '앱 스타일대로 이쁘게'): 이미 올라간 글의 본문만 바꾼다. 알림은 다시 보내지 않는다
  if (!queryFirst(`SELECT 1 AS x FROM setup WHERE key = '${CONTROL_CARD_KEY}'`)) {
    const lines = controlCardSql("../자료", Date.now());
    if (lines) {
      runSql(lines);
      console.log("통제 리스트 공지의 제목·본문을 바꿨어요");
    }
  }
}

// 성장코인샵에서 칠면조 구이·송편 빼기 (제작자 2026-11-10 '칠면조구이 송편은 빼'). 오픈 전이라 신청은 없다. setup 'gcoin_drop_turkey_songpyeon_20261110' 로 한 번만
{
  const KEY = "gcoin_drop_turkey_songpyeon_20261110";
  if (!queryFirst(`SELECT 1 AS x FROM setup WHERE key = '${KEY}'`)) {
    runSql([
      "DELETE FROM gc_items WHERE replace(name, ' ', '') IN ('칠면조구이', '송편');",
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${Date.now()});`,
    ]);
    console.log("성장코인샵 칠면조 구이·송편 뺌 (한 번)");
  }
}

// 개발 요청 #13 (유어아너 '길드에 건의할 건의함좀 만들어주세여') 결재·완료 (제작자 2026-11-10 '유어아너 합의 길마결재 넣고 개발완료 처리해줘': 건의함은 이미 열었다).
// 이번 차례에 유어아너 합의 · 마을모금함 결재 · 퓨앙 개발 완료를 결재 이력에 넣고 상태를 done 으로. 신청한 사람에게 개발 완료 알림. setup 'devreq13_done_20261110' 로 한 번만
{
  const KEY = "devreq13_done_20261110";
  if (!queryFirst(`SELECT 1 AS x FROM setup WHERE key = '${KEY}'`)) {
    const row = queryFirst("SELECT id, round, status, user_id FROM dev_requests WHERE id = 13 AND body LIKE '%건의함%'");
    if (row && row.status !== "done") {
      const now = Date.now();
      runSql([
        `INSERT INTO dev_request_steps (req_id, round, user_id, kind, note, created_at) VALUES (13, ${row.round}, '유어아너', 'agree', NULL, ${now - 2000});`,
        `INSERT INTO dev_request_steps (req_id, round, user_id, kind, note, created_at) VALUES (13, ${row.round}, '마을모금함', 'approve', NULL, ${now - 1000});`,
        `INSERT INTO dev_request_steps (req_id, round, user_id, kind, note, created_at) VALUES (13, ${row.round}, '퓨앙', 'done', '건의함 오픈 (홈 칸 건의함)', ${now});`,
        `UPDATE dev_requests SET status = 'done', updated_at = ${now} WHERE id = 13;`,
        `INSERT INTO alerts (user_id, kind, text, link, created_at) SELECT user_id, 'devreq', '개발 완료 · “길드에 건의할 건의함좀 만들어주세여” · 건의함 오픈 (홈 칸 건의함)', '#/devreq?id=13', ${now} FROM dev_requests WHERE id = 13 AND user_id != '퓨앙';`,
        `INSERT INTO push_queue (kind, created_at, last, claimed_at) VALUES ('devreq', ${now}, '', NULL);`,
        `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
      ]);
      console.log("개발 요청 #13 합의·결재·개발 완료 (한 번)");
    } else {
      runSql([`INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${Date.now()});`]);
      console.log(`개발 요청 #13 은 ${row ? "이미 완료" : "찾지 못함"} (건너뜀)`);
    }
  }
}
