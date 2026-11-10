// 명예의 전당 예전 기부 (제작자 2026-11-10: '기부자별 내역 … 명예의 전당 이 데이터 보고 테스트 데이터 빼고 이거로 적용해줘, 장비나 이런 거는 고려하지 말고 명예의 전당만 금액만').
// 비공개 자료 길드/기부함/예전_기부.json (기부함을 만들기 전 길드 톡방의 기부자별 내역)을 계정 DB(D1)의 donate_items 에 status 'hall' 로 한 번 넣는다.
// - 'hall' 줄은 명예의 전당·기부 내역에만 보이고 마일리지 장부(rental_mileage)와 syncDia 에는 들지 않는다 (예전 기부로 쓸 수 있는 💎 는 생기지 않는다).
// - 넣기 전에 기부함을 시험한 줄(앱개발자·테스트 계정이 만든 것, 테스트 계정 이름의 기부)은 지움(removed)으로 바꾸고 그 줄로 넣은 마일리지를 되돌린다.
// - 기부자 이름은 앱 닉네임 후보(names) 중 앱에 있는 첫 이름, 없으면 첫 이름 그대로 (앱에 없는 사람도 명예의 전당에 이름으로 보인다).
// - 한 번만: D1 setup 'donate_hall_seed_20261110'. 결과(앱에 없는 이름, 지운 시험 줄)는 앱개발자 알림으로, 공개 실행 기록에는 개수만 찍는다.
// 자동 배포(.github/workflows/deploy-web.yml)가 계정 DB 준비 다음에 돌린다.
//   node scripts/donate-hall-seed.mjs [--local]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DB = "sapphire-accounts";
const FILE = "../자료/길드/기부함/예전_기부.json";
const KEY = "donate_hall_seed_20261110";
const DEV = "퓨앙";
const TESTERS = [DEV, "테스트1", "테스트2"];
const where = process.argv.includes("--local") ? "--local" : "--remote";
// 로컬 시험: D1_PERSIST=<wrangler pages dev 의 --persist-to 폴더>
const persist = where === "--local" && process.env.D1_PERSIST ? [`--persist-to=${process.env.D1_PERSIST}`] : [];

if (!existsSync(FILE)) {
  console.log("예전 기부 파일이 없어서 건너뛰어요");
  process.exit(0);
}
const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
// 실패해도 받은 글(닉네임이 든 줄)을 공개 실행 기록에 찍지 않는다
const wrangler = (...args) => {
  try {
    return execFileSync(process.execPath, [WRANGLER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  } catch {
    console.log("wrangler d1 execute 가 실패했어요");
    process.exit(1);
  }
};
const parseJson = (text) => JSON.parse(text.slice(text.search(/[[{]/)));
const query = (sql) => parseJson(wrangler("d1", "execute", DB, where, ...persist, "--json", "--command", sql))[0]?.results ?? [];
const q = (s) => (s === null || s === undefined ? "NULL" : typeof s === "number" ? String(s) : "'" + String(s).replace(/'/g, "''") + "'");

if (query(`SELECT 1 AS x FROM setup WHERE key = ${q(KEY)}`).length) {
  console.log("예전 기부는 이미 넣었어요");
  process.exit(0);
}

const data = JSON.parse(readFileSync(FILE, "utf8"));
const donors = data.donors ?? [];
// 한국 시간 그날 낮 12시 (이번 달 거르기·날짜 표시가 하루 밀리지 않게)
const atOf = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 3);
};
// 앱 닉네임 후보: 앱에 있는 첫 이름 (대소문자는 가리지 않는다), 없으면 첫 이름
const whoSql = (names) => {
  const list = names.map((n) => q(n.toLowerCase())).join(", ");
  const order = names.map((n, i) => `WHEN ${q(n.toLowerCase())} THEN ${i}`).join(" ");
  return `COALESCE((SELECT id FROM users WHERE lower(id) IN (${list}) ORDER BY CASE lower(id) ${order} END LIMIT 1), ${q(names[0])})`;
};

const now = Date.now();
const testCond = `(created_by IN (${TESTERS.map(q).join(", ")}) OR who IN ('테스트1', '테스트2')) AND status IN ('request', 'done')`;
const tests = query(`SELECT id, who, item, qty, enhance, gold, gold_ask, status, dia FROM donate_items WHERE ${testCond}`);

const sql = [];
// 1) 시험 줄: 넣은 마일리지를 되돌리고 지움으로
sql.push(
  `INSERT INTO rental_mileage (who, delta, reason, note, by_user, created_at) SELECT who, -SUM(dia), 'donate', '기부함 · 시험 기부 지움', ${q(DEV)}, ${now} ` +
    `FROM donate_items WHERE ${testCond} GROUP BY who HAVING SUM(dia) != 0;`,
);
sql.push(`UPDATE donate_items SET status = 'removed', dia = 0 WHERE ${testCond};`);
// 2) 예전 기부
let count = 0;
for (const d of donors) {
  const names = (d.names ?? []).filter(Boolean);
  if (!names.length) continue;
  for (const g of d.gifts ?? []) {
    const at = atOf(g.date);
    sql.push(
      "INSERT INTO donate_items (who, item, qty, enhance, note, gold, gold_ask, dia, status, place, created_at, created_by, done_at, done_by) VALUES (" +
        [whoSql(names), q(g.item), 1, 0, q("예전 기부 (기부함 전)"), Math.round(g.gold), Math.round(g.gold), 0, "'hall'", "'keep'", at, q(DEV), at, q(DEV)].join(", ") +
        ");",
    );
    count++;
  }
}
// 3) 앱개발자 알림 (앱에 없는 이름, 지운 시험 줄)
// D1 은 UNION 을 몇 개까지만 받아서 이름 목록을 JSON 하나로 넘긴다
const namesJson = q(JSON.stringify(donors.map((d) => d.names).filter((names) => names?.length)));
const missSql =
  `SELECT json_extract(j.value, '$[0]') AS n FROM json_each(${namesJson}) j ` +
  `WHERE NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.id) IN (SELECT lower(value) FROM json_each(j.value)))`;
const testText = tests.length
  ? ` · 시험 기부 ${tests.length}건 지움: ` + tests.map((t) => `${t.who} ${t.enhance > 0 ? `+${t.enhance} ` : ""}${t.item}`).join(", ")
  : "";
const kept = query(`SELECT who, item, enhance, status FROM donate_items WHERE status IN ('request', 'done') AND NOT (${testCond})`);
const keptText = kept.length
  ? ` · 남겨 둔 기부함 줄 ${kept.length}건: ` + kept.map((t) => `${t.who} ${t.enhance > 0 ? `+${t.enhance} ` : ""}${t.item}`).join(", ")
  : "";
sql.push(
  `INSERT INTO alerts (user_id, kind, text, link, created_at) SELECT ${q(DEV)}, 'donate', ` +
    `${q(`[명예의 전당] 예전 기부 ${count}건(${donors.length}명)을 넣었어요`)} || COALESCE(' · 앱에 없는 이름(이름 그대로): ' || (SELECT group_concat(n, ', ') FROM (${missSql})), '') || ${q(testText + keptText)}, ` +
    `'#/hall', ${now} WHERE EXISTS (SELECT 1 FROM users WHERE id = ${q(DEV)});`,
);
sql.push(`INSERT OR IGNORE INTO setup (key, done_at) VALUES (${q(KEY)}, ${now});`);

const SQL_FILE = join(tmpdir(), `donate-hall-seed-${process.pid}.sql`);
writeFileSync(SQL_FILE, sql.join("\n") + "\n");
try {
  wrangler("d1", "execute", DB, where, ...persist, "--yes", `--file=${SQL_FILE}`);
} finally {
  rmSync(SQL_FILE, { force: true });
}
console.log(`명예의 전당 예전 기부 ${count}건(${donors.length}명)을 넣었어요 (시험 기부 ${tests.length}건 지움)`);
