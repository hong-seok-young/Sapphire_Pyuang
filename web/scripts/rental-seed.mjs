// 장비대여 처음 목록 (제작자 요청 2026-11-01): 대여 담당이 카카오톡에 올리던 대여무기 목록 글(비공개 자료 길드/장비대여/*.txt)로
// 계정 DB(D1)의 rental_items 를 한 번 채운다. 물건이 하나라도 있으면(앱에서 고치기 시작했으면) 아무것도 하지 않는다.
// 🆙 가 붙은 줄은 대여 중으로 넣고 대여 기록(rental_requests, done)도 남긴다. 글을 읽는 것은 server/rentalParse.ts (/api/rent/import 와 같다).
// 자동 배포(.github/workflows/deploy-web.yml)가 계정 DB 준비 다음에 돌린다. 공개 저장소라 실행 기록에는 개수만 찍는다.
//   node --experimental-strip-types scripts/rental-seed.mjs [--local]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRentalList } from "../server/rentalParse.ts";

const DB = "sapphire-accounts";
const DIR = "../자료/길드/장비대여";
const where = process.argv.includes("--local") ? "--local" : "--remote";
const termDays = (t) => (/^\d+w$/.test(t) ? parseInt(t, 10) * 7 : null);

if (!existsSync(DIR)) {
  console.log("장비대여 목록 파일이 없어서 건너뛰어요");
  process.exit(0);
}
const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const wrangler = (...args) => execFileSync(process.execPath, [WRANGLER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const parseJson = (text) => JSON.parse(text.slice(text.search(/[[{]/)));
const q = (s) => (s === null || s === undefined ? "NULL" : typeof s === "number" ? String(s) : "'" + String(s).replace(/'/g, "''") + "'");

const count = Number(parseJson(wrangler("d1", "execute", DB, where, "--json", "--command", "SELECT COUNT(*) AS n FROM rental_items"))[0]?.results?.[0]?.n ?? 0);
if (count > 0) {
  console.log(`장비대여 물건이 이미 ${count}개 있어서 그대로 둬요`);
  process.exit(0);
}

const text = readdirSync(DIR)
  .filter((f) => f.endsWith(".txt"))
  .map((f) => readFileSync(`${DIR}/${f}`, "utf8"))
  .join("\n\n");
const { items, skipped } = parseRentalList(text);
const now = Date.now();
const sql = [];
for (const p of items) {
  const at = p.renter ? p.rentedAt ?? now : null;
  const due = at !== null && termDays(p.term) ? at + termDays(p.term) * 86_400_000 : null;
  sql.push(
    "INSERT INTO rental_items (job, level, weapon, options, enhance, term, price, donor, renter, rented_at, due_at, status, created_at, updated_at, updated_by) VALUES (" +
      [q(p.job), p.level, q(p.weapon), q(p.options), p.enhance, q(p.term), p.price, q(p.donor), q(p.renter), q(at), q(due), "'open'", now, now, "'처음 목록'"].join(", ") +
      ");",
  );
  if (p.renter) {
    sql.push(
      `INSERT INTO rental_requests (item_id, user_id, use_dia, status, created_at, done_at, done_by) VALUES (last_insert_rowid(), ${q(p.renter)}, 0, 'done', ${at}, ${at}, '처음 목록');`,
    );
  }
}
writeFileSync("rental-seed.sql", sql.join("\n") + "\n");
try {
  wrangler("d1", "execute", DB, where, "--yes", "--file=rental-seed.sql");
} finally {
  rmSync("rental-seed.sql", { force: true });
}
console.log(`장비대여 처음 목록 ${items.length}개를 넣었어요 (대여 중 ${items.filter((i) => i.renter).length}개, 읽지 못한 줄 ${skipped.length}개)`);
