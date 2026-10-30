// 길드 계정을 처음 만들 때 한 번 쓰는 스크립트.
// 앱개발자, 길드마스터, 오피서 계정을 임시 비밀번호로 만드는 SQL 을 accounts-seed.sql 에 쓰고,
// 임시 비밀번호를 이 화면에만 보여 준다. accounts-seed.sql 은 공개 저장소에 올리지 않는다(.gitignore). 넣은 뒤 지운다.
//
//   node scripts/make-accounts.mjs
//   npx wrangler d1 execute sapphire-accounts --remote --file=accounts-seed.sql
//   del accounts-seed.sql
//
// 이미 있는 아이디는 건너뛴다 (그 아이디에 보이는 임시 비밀번호는 쓰이지 않는다).
// 길드원 계정은 여기서 만들지 않고, 위키의 '길드원 관리'에서 오피서 이상이 만든다.
import { pbkdf2Sync, randomBytes, randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";

const ITER = 10000; // server/auth.ts 의 PBKDF2_ITER 와 같아야 한다

const ACCOUNTS = [
  ["퓨앙", "developer"], // 앱개발자
  ["마을모금함", "master"], // 길드마스터
  ["멍멍", "officer"],
  ["유어아너", "officer"],
  ["아홀로틀", "officer"],
  ["정서", "officer"],
  ["향단", "officer"],
];

const CHARS = "abcdefghjkmnpqrstuvwxyz23456789"; // 헷갈리는 0 O 1 l I 는 뺐다
const tempPassword = () => Array.from({ length: 8 }, () => CHARS[randomInt(CHARS.length)]).join("");
const sql = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const now = Date.now();
const lines = [];
const shown = [];
for (const [id, role] of ACCOUNTS) {
  const password = tempPassword();
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, ITER, 32, "sha256").toString("base64");
  lines.push(
    "INSERT OR IGNORE INTO users (id, role, pw_hash, pw_salt, pw_iter, must_change, created_at, created_by) VALUES (" +
      [sql(id), sql(role), sql(hash), sql(salt.toString("base64")), ITER, 1, now, sql("setup")].join(", ") +
      ");",
  );
  shown.push(`${id}\t${role}\t${password}`);
}

writeFileSync(new URL("../accounts-seed.sql", import.meta.url), lines.join("\n") + "\n", "utf8");
console.log("accounts-seed.sql 을 만들었어요. 아래 임시 비밀번호를 각자에게 따로 알려 주세요.");
console.log("처음 로그인하면 자기 비밀번호로 바꾸게 돼요.\n");
console.log("아이디\t역할\t임시 비밀번호");
console.log(shown.join("\n"));
