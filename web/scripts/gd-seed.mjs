// 길드 던전 파티 처음 세팅 (제작자 요청 2026-11-03: '길드던전 파티 8개임 세팅해줘', 줄마다 닉네임 넷과 '4단계').
// 비공개 자료 길드/길드던전_파티.txt 의 줄마다 '닉네임 닉네임 닉네임 닉네임 N단계' (맨 끝 'N단계'는 없어도 된다, # 으로 시작하는 줄은 설명).
// - 이 파일이 파티 명단의 기준이다: 계정이 있는 닉네임은 적힌 파티로 간다. 다른 파티에 있던 사람도 옮긴다
//   (제작자 2026-11-03 '유어아너랑 퓨앙도 제자리 찾아가야지': 처음 돌 때는 이미 파티에 있는 사람을 건너뛰었다). 줄의 사람만으로 된 파티가 이미 있으면 거기에 넣고
//   없으면 새로 만든다 (첫 사람이 파티장, 이름 'OO 팀'). 파티는 4명까지라 넘치는 사람은 넣지 않고 알린다. 사람이 다 빠진 파티는 지우고, 파티장이 빠졌으면 먼저 들어온 사람에게.
// - 같은 파일은 한 번만 돈다 (setup 'gd_seed_<파일 해시>'. 파일을 고치면(설명 줄 하나라도) 새 해시로 다시 돈다).
// - 결과(만든 파티·옮긴 사람 수, 못 찾은 닉네임, 옮긴 사람, 넘쳐서 못 넣은 사람, 2군·길드 미정인 사람)는 앱개발자에게 알림(gdungeon)으로 보내고,
//   들어가거나 옮겨진 사람에게는 알림. 공개 저장소 실행 기록에는 개수만 찍는다 (닉네임은 안 찍는다).
// 자동 배포(.github/workflows/deploy-web.yml)가 계정 DB 준비(ci-d1.mjs: gd_parties.stage 칸) 다음에 돌린다.
//   node scripts/gd-seed.mjs [--local [--persist-to <폴더>]] [--file <경로>]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DB = "sapphire-accounts";
const args = process.argv.slice(2);
const where = args.includes("--local") ? "--local" : "--remote";
/** 로컬 시험 때 wrangler pages dev 와 같은 자료 폴더를 쓰려고 (--persist-to <폴더>) */
const persist = args.includes("--persist-to") ? ["--persist-to", args[args.indexOf("--persist-to") + 1]] : [];
const FILE = args.includes("--file") ? args[args.indexOf("--file") + 1] : "../자료/길드/길드던전_파티.txt";
const MAX_MEMBERS = 4;
const MAX_STAGE = 9;

if (!existsSync(FILE)) {
  console.log("길드 던전 파티 파일이 없어서 건너뛰어요");
  process.exit(0);
}
const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const wrangler = (...a) => execFileSync(process.execPath, [WRANGLER, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const parseJson = (text) => JSON.parse(text.slice(text.search(/[[{]/)));
const query = (sql) => parseJson(wrangler("d1", "execute", DB, where, ...persist, "--json", "--command", sql))[0]?.results ?? [];
const q = (s) => (s === null || s === undefined ? "NULL" : typeof s === "number" ? String(s) : "'" + String(s).replace(/'/g, "''") + "'");

const text = readFileSync(FILE, "utf8");
const key = "gd_seed_" + createHash("sha256").update(text).digest("hex").slice(0, 16);
if (query(`SELECT 1 AS done FROM setup WHERE key = ${q(key)}`).length) {
  console.log("길드 던전 파티는 이 파일로 이미 만들었어요");
  process.exit(0);
}

/** 줄 -> { names, stage } */
const lines = text
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => {
    const parts = l.split(/\s+/);
    let stage = null;
    const m = /^(\d+)단계$/.exec(parts[parts.length - 1]);
    if (m) {
      stage = Math.min(MAX_STAGE, Math.max(1, Number(m[1])));
      parts.pop();
    }
    return { names: [...new Set(parts)], stage };
  })
  .filter((p) => p.names.length);

const users = new Map(query("SELECT u.id AS id, p.guild AS guild FROM users u LEFT JOIN profiles p ON p.user_id = u.id").map((r) => [r.id, r.guild]));
/** 지금 누가 어느 파티에 있는지, 파티마다 사람들 */
const memberOf = new Map(query("SELECT user_id, party_id FROM gd_members").map((r) => [r.user_id, Number(r.party_id)]));
const partyOf = new Map();
for (const [u, pid] of memberOf) partyOf.set(pid, [...(partyOf.get(pid) ?? []), u]);
const leaders = new Map(query("SELECT id, leader FROM gd_parties").map((r) => [Number(r.id), r.leader]));
const dev = query("SELECT id FROM users WHERE role = 'developer' ORDER BY created_at LIMIT 1")[0]?.id ?? null;
const now = Date.now();
const sql = [];
const missing = [];
const moved = [];
const overflow = [];
const notMain = [];
const touched = new Set();
let made = 0;
let put = 0;
const alertTo = (u, msg) =>
  sql.push(
    `INSERT INTO alerts (user_id, kind, text, link, created_at) SELECT ${q(u)}, 'gdungeon', ${q(msg)}, '#/match', ${now} ` +
      `WHERE COALESCE((SELECT enabled FROM alert_prefs WHERE user_id = ${q(u)} AND kind = 'gdungeon'), 1) = 1;`,
  );
for (const line of lines) {
  const found = line.names.filter((n) => users.has(n));
  missing.push(...line.names.filter((n) => !users.has(n)));
  if (!found.length) continue;
  // 이 줄의 사람만으로 된 파티가 이미 있으면 그 파티 (여럿이면 사람이 가장 많은 것)
  const pure = [...partyOf.entries()].filter(([, ms]) => ms.every((u) => line.names.includes(u))).sort((a, b) => b[1].length - a[1].length)[0];
  let pid;
  let leader;
  let inside;
  if (pure) {
    pid = pure[0];
    leader = leaders.get(pid);
    inside = [...pure[1]];
  } else {
    leader = found[0];
    inside = [];
    sql.push(`INSERT INTO gd_parties (name, leader, created_at, stage) VALUES (${q(`${leader} 팀`)}, ${q(leader)}, ${now}, ${q(line.stage)});`);
    pid = `(SELECT id FROM gd_parties WHERE leader = ${q(leader)} ORDER BY id DESC LIMIT 1)`;
    made++;
  }
  if (pure && line.stage) sql.push(`UPDATE gd_parties SET stage = ${line.stage} WHERE id = ${pid};`);
  const team = `${leader} 팀`;
  for (const u of found) {
    if (inside.includes(u)) continue;
    if (inside.length >= MAX_MEMBERS) {
      overflow.push(u);
      continue;
    }
    const was = memberOf.get(u);
    if (was !== undefined) {
      // 다른 파티에 있던 사람: 옮긴다
      partyOf.set(was, (partyOf.get(was) ?? []).filter((x) => x !== u));
      touched.add(was);
      sql.push(`UPDATE gd_members SET party_id = ${pid}, joined_at = ${now} WHERE user_id = ${q(u)};`);
      moved.push(u);
      alertTo(u, `${line.stage ? `${line.stage}단계 ` : ""}${team}으로 옮겼어요 (파티장 ${leader}) · 이번 주 시간표를 칠해 주세요`);
    } else {
      sql.push(`INSERT INTO gd_members (user_id, party_id, joined_at) VALUES (${q(u)}, ${pid}, ${now});`);
      alertTo(u, `${line.stage ? `${line.stage}단계 ` : ""}${team}에 들어왔어요 (파티장 ${leader}) · 이번 주 시간표를 칠해 주세요`);
      put++;
    }
    inside.push(u);
    memberOf.set(u, typeof pid === "number" ? pid : -1);
    if (users.get(u) !== "main") notMain.push(u);
  }
  if (typeof pid === "number") partyOf.set(pid, inside);
}
// 사람이 빠진 파티: 비었으면 지우고, 파티장이 빠졌으면 먼저 들어온 사람에게
for (const pid of touched) {
  const ms = partyOf.get(pid) ?? [];
  if (!ms.length) {
    sql.push(`DELETE FROM gd_answers WHERE party_id = ${pid};`, `DELETE FROM gd_parties WHERE id = ${pid};`);
  } else if (!ms.includes(leaders.get(pid))) {
    sql.push(
      `UPDATE gd_parties SET leader = (SELECT user_id FROM gd_members WHERE party_id = ${pid} ORDER BY joined_at, user_id LIMIT 1) WHERE id = ${pid};`,
    );
  }
}
// 앱개발자에게 결과 (알림 글은 200자까지라 나눠 보낸다)
if (dev) {
  const notes = [`길드 던전 파티 세팅: 파티 ${made}개 새로, 사람 ${put}명 넣고 ${moved.length}명 옮겼어요`];
  if (missing.length) notes.push(`계정을 못 찾은 닉네임 ${missing.length}: ${missing.join(", ")}`);
  if (moved.length) notes.push(`다른 파티에서 옮긴 사람 ${moved.length}: ${moved.join(", ")}`);
  if (overflow.length) notes.push(`파티가 4명이라 못 넣은 사람 ${overflow.length}: ${overflow.join(", ")}`);
  if (notMain.length) notes.push(`1군이 아니거나 길드 미정이라 길드 던전을 못 여는 사람 ${notMain.length}: ${notMain.join(", ")}`);
  for (const n of notes) {
    for (let i = 0; i < n.length; i += 190) {
      sql.push(`INSERT INTO alerts (user_id, kind, text, link, created_at) VALUES (${q(dev)}, 'gdungeon', ${q(n.slice(i, i + 190))}, '#/match', ${now});`);
    }
  }
}
sql.push(`INSERT OR REPLACE INTO setup (key, done_at) VALUES (${q(key)}, ${now});`);
writeFileSync("gd-seed.sql", sql.join("\n") + "\n");
try {
  wrangler("d1", "execute", DB, where, ...persist, "--yes", "--file=gd-seed.sql");
} finally {
  rmSync("gd-seed.sql", { force: true });
}
console.log(`길드 던전 파티 ${made}개 새로, 사람 ${put}명 넣고 ${moved.length}명 옮겼어요 · 못 찾은 닉네임 ${missing.length}, 못 넣은 사람 ${overflow.length}, 1군 아님 ${notMain.length}`);
