// 자동 배포(.github/workflows/deploy-web.yml)에서 계정 DB(D1)를 준비한다.
//  1. sapphire-accounts DB 가 없으면 아시아(apac)에 만들고, 그 database_id 를 wrangler.toml 에 넣는다
//     (배포하는 서버의 작업 폴더에서만 바꾸고 커밋하지 않는다)
//  2. schema.sql 을 넣는다 (CREATE TABLE IF NOT EXISTS 라 몇 번을 해도 된다). 이미 있는 표에 나중에 더한 칸은 ALTER TABLE 로 넣는다
//  3. 계정이 하나도 없을 때만 앱개발자 계정(퓨앙)을 저장소 비밀값 DEV_PASSWORD 로 만든다.
//  4. 저장소 비밀값 FIRST_PASSWORD 가 있으면 시작 계정(길드마스터, 오피서)을 한 번만 만든다 (제작자 요청).
//     이미 있는 아이디는 그대로 두고, 한 번 만든 뒤에는 다시 만들지 않는다 (지운 계정이 배포 때 되살아나지 않게).
// 3, 4 의 계정은 처음 로그인하면 비밀번호를 바꾸게 한다. 그 밖의 길드원은 '길드원 관리'에서 만든다.
// 공개 저장소라 실행 기록을 누구나 볼 수 있으므로 비밀번호, 해시, SQL 은 화면에 찍지 않는다.
import { execFileSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

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

function findDb() {
  return parseJson(wrangler("d1", "list", "--json")).find((d) => d.name === DB)?.uuid;
}

let id = findDb();
if (!id) {
  wrangler("d1", "create", DB, "--location=apac", "--update-config=false");
  id = findDb();
  console.log("계정 DB를 새로 만들었어요");
}
if (!id) throw new Error("계정 DB를 찾지 못했어요: " + DB);
const toml = readFileSync("wrangler.toml", "utf8");
writeFileSync("wrangler.toml", toml.replace(/^database_id = ".*"$/m, `database_id = "${id}"`));

wrangler("d1", "execute", DB, "--remote", "--yes", "--file=schema.sql");

/** schema.sql 은 이미 있는 표를 바꾸지 않는다. 나중에 더한 칸: [표, 칸, 종류] */
const ADDED_COLUMNS = [
  ["profiles", "exp", "INTEGER"], ["listings", "options", "TEXT"], ["profiles", "guild", "TEXT"],
  ["listings", "mode", "TEXT NOT NULL DEFAULT 'sale'"], ["listings", "ends_at", "INTEGER"], ["listing_wants", "offer", "INTEGER"],
];
for (const [table, column, type] of ADDED_COLUMNS) {
  const columns = parseJson(wrangler("d1", "execute", DB, "--remote", "--json", "--command", `PRAGMA table_info(${table})`))[0]?.results ?? [];
  if (!columns.some((c) => c.name === column)) {
    wrangler("d1", "execute", DB, "--remote", "--yes", "--command", `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`${table} 표에 ${column} 칸을 더했어요`);
  }
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
