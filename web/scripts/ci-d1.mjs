// 자동 배포(.github/workflows/deploy-web.yml)에서 계정 DB(D1)를 준비한다.
//  1. sapphire-accounts DB 가 없으면 아시아(apac)에 만들고, 그 database_id 를 wrangler.toml 에 넣는다
//     (배포하는 서버의 작업 폴더에서만 바꾸고 커밋하지 않는다)
//  2. schema.sql 을 넣는다 (CREATE TABLE IF NOT EXISTS 라 몇 번을 해도 된다)
//  3. 계정이 하나도 없을 때만 앱개발자 계정(퓨앙)을 저장소 비밀값 DEV_PASSWORD 로 만든다.
//     처음 로그인하면 비밀번호를 바꾸게 한다. 길드마스터와 오피서는 퓨앙이 위키 '길드원 관리'에서 만든다.
// 공개 저장소라 실행 기록을 누구나 볼 수 있으므로 비밀번호, 해시, SQL 은 화면에 찍지 않는다.
import { execFileSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const DB = "sapphire-accounts";
const DEVELOPER = "퓨앙";
const ITER = 10000; // server/auth.ts 의 PBKDF2_ITER 와 같아야 한다

/** wrangler 를 실행하고 표준 출력을 돌려준다 (화면에는 안 찍는다. 오류는 그대로 보인다) */
function wrangler(...args) {
  return execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

/** --json 출력에서 JSON 부분만 읽는다 */
function parseJson(text) {
  return JSON.parse(text.slice(text.search(/[[{]/)));
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

const result = parseJson(wrangler("d1", "execute", DB, "--remote", "--json", "--command", "SELECT COUNT(*) AS n FROM users"));
const count = Number(result[0]?.results?.[0]?.n ?? 0);
if (count > 0) {
  console.log(`계정 ${count}개`);
} else {
  const password = process.env.DEV_PASSWORD ?? "";
  if (password.length < 6) {
    console.log("::warning::계정이 하나도 없는데 DEV_PASSWORD 비밀값이 없거나 6자보다 짧아서 첫 계정을 못 만들었어요");
  } else {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(password, salt, ITER, 32, "sha256").toString("base64");
    const values = [`'${DEVELOPER}'`, "'developer'", `'${hash}'`, `'${salt.toString("base64")}'`, ITER, 1, Date.now(), "'setup'"];
    writeFileSync(
      "first-account.sql",
      "INSERT OR IGNORE INTO users (id, role, pw_hash, pw_salt, pw_iter, must_change, created_at, created_by) VALUES (" +
        values.join(", ") +
        ");\n",
    );
    try {
      wrangler("d1", "execute", DB, "--remote", "--yes", "--file=first-account.sql");
    } finally {
      rmSync("first-account.sql", { force: true });
    }
    console.log(`첫 계정(${DEVELOPER})을 만들었어요`);
  }
}
