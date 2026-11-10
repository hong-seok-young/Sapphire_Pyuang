// 예전 기부 (기부함 전, 제작자 2026-11-10 길드 톡방의 '기부자별 내역'): 비공개 자료 길드/기부함/예전_기부.json 을 계정 DB(D1)의 donate_items 에 status 'hall' 로 넣고
// 그 골드 가치로 마일리지를 준다.
// - 처음 (2026-11-10 '명예의 전당만 금액만'): 명예의 전당에만 넣었다 (setup 'donate_hall_seed_20261110'). 그때 기부함 시험 줄(앱개발자·테스트 계정이 만든 것)은 지움으로 바꾸고 마일리지를 되돌렸다.
// - 다음 (같은 날 '지금 인원별로 마일리지를 직접 배부만, 장비대여 리스트는 그대로', '아홀로틀은 +7 다크스틸소드 850만'): 예전 기부 줄을 JSON 그대로 다시 맞추고
//   사람마다 마일리지를 준다 (setup 'donate_hall_mileage_20261110'). 장비대여 물건(rental_items)은 건드리지 않는다.
//   마일리지 = (그 사람의 기부함 확정 + 예전 기부 골드 합) x 0.6 / 10만 내림 (server/donate.ts syncDia 와 같은 셈). 이미 받은 몫(기부함 줄의 dia)과
//   장비대여에서 운영진이 적어 준 기부 💎(rental_mileage reason 'donate', 기부함 줄 아닌 것: 같은 장비를 두 번 주지 않게)는 빼고 모자란 만큼만 장부에 넣는다.
//   예전 기부 줄의 dia 에 그 사람 몫을 적어 '한 사람의 dia 합 = 확정 골드 합 / 10만 x 0.6 내림'을 지킨다 (그래야 다음 기부함 확정 때 syncDia 가 차이만 준다).
// - 기부자 이름은 앱 닉네임 후보(names) 중 앱에 있는 첫 이름, 없으면 첫 이름 그대로 (장부는 닉네임 글자라 앱에 없는 사람도 쌓인다).
// - 결과(사람마다 💎, 뺀 장비대여 기부, 앱에 없는 이름)는 앱개발자 알림으로, 공개 실행 기록에는 개수만 찍는다.
// - 셋째 (같은 날 '장비대여에만 있는 기부자도 명예의 전당에, 장비대여 보증금은 실제 골드 가격의 1.5배라 1.5 로 나눠서'): 장비대여 물건(rental_items)의 기부자를
//   status 'honor' 줄로 넣는다 (setup 'donate_hall_rent_20261110'). 골드 가치 = 보증금 💎 x 10만 / 1.5, 명예의 전당 💎 = 그 x 0.6 / 10만 (= 보증금 x 0.4).
//   'honor' 는 명예의 전당·기부 내역에만 보이고 마일리지에는 들지 않는다. 기부함에서 넘어간 물건(donate_items.rental_id)과 내린 물건, 예전 기부와 같은 물건
//   (JSON 의 rentalDuplicates: [기부자, 무기 이름 일부])은 뺀다. 카톡 목록으로 처음 채운 물건(11/2 전)은 날짜를 몰라 10/31 로, 그 뒤 앱에서 올린 물건은 올린 날로.
// 자동 배포(.github/workflows/deploy-web.yml)가 계정 DB 준비 다음에 돌린다.
//   node scripts/donate-hall-seed.mjs [--local]      (로컬 시험: D1_PERSIST=<wrangler pages dev 의 --persist-to 폴더>)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DB = "sapphire-accounts";
const FILE = "../자료/길드/기부함/예전_기부.json";
const KEY_SEED = "donate_hall_seed_20261110";
const KEY = "donate_hall_mileage_20261110";
const KEY_RENT = "donate_hall_rent_20261110";
const RENT_NOTE = "장비대여 기부 (기부함 전)";
const DEV = "퓨앙";
const TESTERS = [DEV, "테스트1", "테스트2"];
const NOTE = "예전 기부 (기부함 전)";
const LEDGER_NOTE = "기부함 · 예전 기부 (기부함 전)";
const where = process.argv.includes("--local") ? "--local" : "--remote";
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
const runSql = (lines) => {
  const file = join(tmpdir(), `donate-hall-seed-${process.pid}-${Date.now()}.sql`);
  writeFileSync(file, lines.join("\n") + "\n");
  try {
    wrangler("d1", "execute", DB, where, ...persist, "--yes", `--file=${file}`);
  } finally {
    rmSync(file, { force: true });
  }
};

const done = new Set(query(`SELECT key FROM setup WHERE key IN (${q(KEY_SEED)}, ${q(KEY)}, ${q(KEY_RENT)})`).map((r) => r.key));
if (done.has(KEY) && done.has(KEY_RENT)) {
  console.log("예전 기부 마일리지와 장비대여 기부는 이미 넣었어요");
  process.exit(0);
}

const data = JSON.parse(readFileSync(FILE, "utf8"));
const donors = (data.donors ?? []).filter((d) => d.names?.length);
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

if (!done.has(KEY)) seedOld();
if (!done.has(KEY_RENT)) seedRent();

function seedOld() {
// 1) 예전 기부 줄을 JSON 그대로 다시 맞춘다 (처음이면 기부함 시험 줄도 정리)
const a = [];
let tests = [];
if (!done.has(KEY_SEED)) {
  const testCond = `(created_by IN (${TESTERS.map(q).join(", ")}) OR who IN ('테스트1', '테스트2')) AND status IN ('request', 'done')`;
  tests = query(`SELECT who, item, enhance FROM donate_items WHERE ${testCond}`);
  a.push(
    `INSERT INTO rental_mileage (who, delta, reason, note, by_user, created_at) SELECT who, -SUM(dia), 'donate', '기부함 · 시험 기부 지움', ${q(DEV)}, ${now} ` +
      `FROM donate_items WHERE ${testCond} GROUP BY who HAVING SUM(dia) != 0;`,
    `UPDATE donate_items SET status = 'removed', dia = 0 WHERE ${testCond};`,
  );
}
a.push(`DELETE FROM donate_items WHERE status = 'hall' AND note = ${q(NOTE)} AND created_by = ${q(DEV)};`);
let count = 0;
for (const d of donors) {
  for (const g of d.gifts ?? []) {
    const at = atOf(g.date);
    a.push(
      "INSERT INTO donate_items (who, item, qty, enhance, note, gold, gold_ask, dia, status, place, created_at, created_by, done_at, done_by) VALUES (" +
        [whoSql(d.names), q(g.item), 1, 0, q(NOTE), Math.round(g.gold), Math.round(g.gold), 0, "'hall'", "'keep'", at, q(DEV), at, q(DEV)].join(", ") +
        ");",
    );
    count++;
  }
}
a.push(`INSERT OR IGNORE INTO setup (key, done_at) VALUES (${q(KEY_SEED)}, ${now});`);
runSql(a);

// 2) 사람마다 마일리지 (예전 기부가 있는 사람만)
const people = query(
  "SELECT who, COALESCE(SUM(CASE WHEN status IN ('done', 'hall') THEN gold ELSE 0 END), 0) AS gold, COALESCE(SUM(dia), 0) AS dia, " +
    "MAX(CASE WHEN status = 'hall' THEN id END) AS hall_id FROM donate_items " +
    "WHERE who IN (SELECT who FROM donate_items WHERE status = 'hall') GROUP BY who",
);
const prior = new Map(
  query(
    "SELECT who, COALESCE(SUM(delta), 0) AS n FROM rental_mileage WHERE reason = 'donate' AND (note IS NULL OR note NOT LIKE '기부함 · %') " +
      "AND who IN (SELECT who FROM donate_items WHERE status = 'hall') GROUP BY who",
  ).map((r) => [r.who, Math.max(0, Number(r.n) || 0)]),
);
const usable = (gold) => Math.floor((gold * 6) / 1_000_000);
const b = [];
const lines = [];
let given = 0;
let paid = 0;
for (const p of people.sort((x, y) => y.gold - x.gold)) {
  const target = usable(Number(p.gold) || 0);
  const had = Number(p.dia) || 0;
  const before = prior.get(p.who) ?? 0;
  const give = Math.max(0, target - had - before);
  // 이 사람의 dia 합 = target (예전 기부 줄 하나에 모자란 몫을 적는다)
  if (p.hall_id && target - had !== 0) b.push(`UPDATE donate_items SET dia = ${target - had} WHERE id = ${p.hall_id};`);
  if (give > 0) {
    b.push(
      `INSERT INTO rental_mileage (who, delta, reason, note, by_user, created_at) VALUES (${q(p.who)}, ${give}, 'donate', ${q(LEDGER_NOTE)}, ${q(DEV)}, ${now});`,
    );
    paid++;
    given += give;
  }
  if (target > 0 || before > 0) lines.push(`${p.who} 💎${give}${before > 0 ? ` (장비대여 기부 💎${before} 빼고)` : ""}`);
}
// 앱개발자 알림 (사람마다 💎, 앱에 없는 이름)
const namesJson = q(JSON.stringify(donors.map((d) => d.names)));
const missSql =
  `SELECT json_extract(j.value, '$[0]') AS n FROM json_each(${namesJson}) j ` +
  `WHERE NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.id) IN (SELECT lower(value) FROM json_each(j.value)))`;
const testText = tests.length ? ` · 시험 기부 ${tests.length}건 지움: ` + tests.map((t) => `${t.who} ${t.enhance > 0 ? `+${t.enhance} ` : ""}${t.item}`).join(", ") : "";
b.push(
  `INSERT INTO alerts (user_id, kind, text, link, created_at) SELECT ${q(DEV)}, 'donate', ` +
    `${q(`[기부함] 예전 기부 ${count}건(${donors.length}명) 마일리지 💎${given} 넣음 · ${lines.join(" · ")}`)} || ` +
    `COALESCE(' · 앱에 없는 이름(이름 그대로 장부에): ' || (SELECT group_concat(n, ', ') FROM (${missSql})), '') || ${q(testText)}, ` +
    `'#/hall', ${now} WHERE EXISTS (SELECT 1 FROM users WHERE id = ${q(DEV)});`,
);
b.push(`INSERT OR IGNORE INTO setup (key, done_at) VALUES (${q(KEY)}, ${now});`);
runSql(b);
console.log(`예전 기부 ${count}건(${donors.length}명)을 맞추고 마일리지를 ${paid}명에게 넣었어요 (시험 기부 ${tests.length}건 지움)`);
}

// 3) 장비대여 물건의 기부자 -> 명예의 전당 (status 'honor', 마일리지 없음)
function seedRent() {
  const dup = (data.rentalDuplicates ?? []).map(([who, weapon]) => [String(who).toLowerCase(), String(weapon).replace(/\s/g, "")]);
  const rows = query(
    "SELECT id, donor, weapon, enhance, price, created_at FROM rental_items WHERE donor IS NOT NULL AND trim(donor) != '' AND status != 'gone' " +
      "AND id NOT IN (SELECT rental_id FROM donate_items WHERE rental_id IS NOT NULL) ORDER BY id",
  );
  const before = Date.UTC(2026, 10, 2, 15); // 2026-11-03 0시 한국 시간: 그 전은 카톡 목록으로 처음 채운 물건
  const oldAt = Date.UTC(2026, 9, 31, 3); // 10/31 낮 12시 한국 시간
  const c = [`DELETE FROM donate_items WHERE status = 'honor' AND note = ${q(RENT_NOTE)} AND created_by = ${q(DEV)};`];
  const per = new Map();
  let skipped = 0;
  for (const r of rows) {
    const who = String(r.donor).trim();
    const name = String(r.weapon).replace(/\s/g, "");
    if (dup.some(([w, n]) => w === who.toLowerCase() && name.includes(n))) {
      skipped++;
      continue;
    }
    const gold = Math.round((Number(r.price) * 100_000) / 1.5);
    const at = Number(r.created_at) < before ? oldAt : Number(r.created_at);
    c.push(
      "INSERT INTO donate_items (who, item, qty, enhance, note, gold, gold_ask, dia, status, place, rental_id, created_at, created_by, done_at, done_by) VALUES (" +
        [whoSql([who]), q(r.weapon), 1, Number(r.enhance) || 0, q(RENT_NOTE), gold, gold, 0, "'honor'", "'rent'", r.id, at, q(DEV), at, q(DEV)].join(", ") +
        ");",
    );
    const p = per.get(who) ?? { n: 0, price: 0 };
    p.n++;
    p.price += Number(r.price) || 0;
    per.set(who, p);
  }
  const list = [...per.entries()].sort((x, y) => y[1].price - x[1].price);
  const text = list.map(([who, p]) => `${who} ${p.n}개 💎${Math.round(p.price * 0.4 * 100) / 100}`).join(" · ");
  c.push(
    `INSERT INTO alerts (user_id, kind, text, link, created_at) SELECT ${q(DEV)}, 'donate', ` +
      `${q(`[명예의 전당] 장비대여 기부 ${rows.length - skipped}개(${list.length}명) 넣음 (보증금 ÷ 1.5 = 골드, 마일리지는 안 줌, 예전 기부와 같은 ${skipped}개 뺌) · ${text}`)}, ` +
      `'#/hall', ${now} WHERE EXISTS (SELECT 1 FROM users WHERE id = ${q(DEV)});`,
    `INSERT OR IGNORE INTO setup (key, done_at) VALUES (${q(KEY_RENT)}, ${now});`,
  );
  runSql(c);
  console.log(`장비대여 기부 ${rows.length - skipped}개(${list.length}명)를 명예의 전당에 넣었어요 (예전 기부와 같은 ${skipped}개 뺌)`);
}
