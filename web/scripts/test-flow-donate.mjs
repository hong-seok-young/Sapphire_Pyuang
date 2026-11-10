// 기부함 → 마일리지 → 장비대여 → 명예의 전당 연계 시험 (제작자 2026-11-10 '데이터가 실시간으로 연동돼야 하는 것들은 상호 흐름·기능 검사 테스트를 꼭').
// 로컬 서버(npm run dev:accounts 또는 wrangler pages dev ... --persist-to …)에 두 계정으로 로그인해 기부 신청부터 반납까지 한 바퀴 돌고, 만든 것은 끝에 지운다.
//   BASE=http://127.0.0.1:8788 PW=<로컬 비밀번호> STAFF=퓨앙 MEMBER=테스트1 node scripts/test-flow-donate.mjs
// 실서비스에 대고 돌리지 않는다 (기부·마일리지 장부가 실제로 남는다). 기부함·장비대여·명예의 전당·마일리지를 고치면 고친 뒤 돌린다 (CLAUDE.md '연동 기능은 흐름 시험').
const BASE = process.env.BASE || "http://127.0.0.1:8788";
const PW = process.env.PW || "test1234";
const STAFF = process.env.STAFF || "퓨앙";
const MEMBER = process.env.MEMBER || "테스트1";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error("로컬 서버에서만 돌린다 (BASE=" + BASE + ")");

let fail = 0;
const ok = (c, m) => {
  console.log((c ? "PASS " : "FAIL ") + m);
  if (!c) fail++;
};
const jar = {};
async function login(id) {
  const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, password: PW }) });
  const c = r.headers.get("set-cookie");
  if (!c) throw new Error(`로그인 못 함: ${id} ${r.status} ${await r.text()}`);
  jar[id] = c.split(";")[0];
}
async function api(id, path, method = "GET", body) {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie: jar[id] }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { s: r.status, j };
}
const mileage = async (id) => (await api(id, "/api/rent")).j.mileage;
const hallOf = async (name) => {
  const h = (await api(STAFF, "/api/donate/hall?period=all")).j;
  return h.hall.find((x) => x.names.includes(name) || x.name === name) ?? { earned: 0, gold: 0, count: 0 };
};

await login(STAFF);
await login(MEMBER);
const made = { donations: [], items: [] };
try {
  const m0 = await mileage(MEMBER);
  const h0 = await hallOf(MEMBER);

  // 1) 길드원 기부 신청: 위키 무기(프리셋 옵션)와 위키에 없는 물건(줄글 옵션 두 가지 표기)
  const d1 = await api(MEMBER, "/api/donate", "POST", { item: "헌터보우", qty: 1, enhance: 8, options: "명중 9 · 민첩 8", gold: 2_500_000 });
  ok(d1.s < 300, `기부 신청 (헌터보우 +8) ${d1.s}`);
  made.donations.push(d1.j.id);
  const d2 = await api(MEMBER, "/api/donate", "POST", { item: "시험용 반지", qty: 1, options: "지3 마재2", gold: 50_000 });
  const d3 = await api(MEMBER, "/api/donate", "POST", { item: "시험용 목걸이", qty: 1, options: "지능3 마나재생 2", enchant: "체력 30", gold: 50_000 });
  made.donations.push(d2.j.id, d3.j.id);
  const bad = await api(MEMBER, "/api/donate", "POST", { item: "시험", enchant: "힘 9" });
  ok(bad.s === 400, `속성부여 값 검사 (힘 9 -> 400) ${bad.s}`);
  const mine = (await api(MEMBER, "/api/donate")).j.mine;
  const r2 = mine.find((r) => r.id === d2.j.id);
  const r3 = mine.find((r) => r.id === d3.j.id);
  ok(r2?.options === "지능 3 · 마나재생 2" && r3?.options === "지능 3 · 마나재생 2", `옵션 표기 통일: '${r2?.options}' / '${r3?.options}'`);
  ok(r3?.enchant === "체력 30", `속성부여 저장 '${r3?.enchant}'`);
  ok((await mileage(MEMBER)) === m0, "확정 전에는 마일리지 그대로");

  // 2) 운영진 확정 -> 마일리지 (골드 x 0.6 / 10만, 소수는 쌓고 정수만 쓴다)
  const c1 = await api(STAFF, `/api/donate/${d1.j.id}`, "PUT", { action: "confirm", gold: 2_500_000 });
  ok(c1.s === 200 && c1.j.dia === 15, `확정 250만 -> 💎+${c1.j?.dia} (15)`);
  ok((await mileage(MEMBER)) === m0 + 15, "장비대여 마일리지에 바로 +15");
  const c2 = await api(STAFF, `/api/donate/${d2.j.id}`, "PUT", { action: "confirm", gold: 50_000 });
  ok(c2.j?.dia === 0, `확정 5만 (0.3) -> 💎+${c2.j?.dia} (0, 소수는 쌓임)`);
  const c3 = await api(STAFF, `/api/donate/${d3.j.id}`, "PUT", { action: "confirm", gold: 150_000 });
  ok(c3.j?.dia === 1, `확정 15만 (0.9, 쌓인 0.3 과 합쳐 1.2) -> 💎+${c3.j?.dia} (1)`);
  ok((await mileage(MEMBER)) === m0 + 16, "마일리지 +16 (15 + 1)");
  const h1 = await hallOf(MEMBER);
  ok(Math.abs(h1.earned - h0.earned - 16.2) < 1e-6, `명예의 전당 쌓인 마일리지 +${(h1.earned - h0.earned).toFixed(2)} (16.2)`);
  ok(h1.gold - h0.gold === 2_700_000, `명예의 전당 기부 가치 +${h1.gold - h0.gold}`);

  // 3) 장비대여 운용 -> 물건 추가 목록 -> 올리기 (옵션은 장비대여 줄임말로)
  ok((await api(STAFF, `/api/donate/${d1.j.id}`, "PUT", { action: "rent" })).s === 200, "장비대여 운용");
  const staffRent = (await api(STAFF, "/api/rent")).j;
  const g = (staffRent.donated ?? []).find((x) => x.id === d1.j.id);
  ok(!!g && g.options === "명중 9 · 민첩 8", `물건 추가 목록에 넘어옴 (옵션 '${g?.options}')`);
  const add = await api(STAFF, "/api/rent", "POST", { donateId: d1.j.id, job: "ranger", level: 27, weapon: "헌터보우", options: "명중 9 · 민첩 8", enhance: 8, term: "2w", price: 10, note: "" });
  ok(add.s < 300, `물건 추가 ${add.s} ${add.j?.error ?? ""}`);
  const itemId = add.j?.id;
  made.items.push(itemId);
  let item = (await api(MEMBER, "/api/rent")).j.items.find((i) => i.id === itemId);
  ok(item?.options === "명9민8" && item?.donor === MEMBER && item?.enhance === 8, `대여 목록: 옵션 '${item?.options}', 기부 ${item?.donor}, +${item?.enhance}`);
  const add2 = await api(STAFF, "/api/rent", "POST", { donateId: d1.j.id, job: "ranger", level: 27, weapon: "헌터보우", options: "", enhance: 8, term: "2w", price: 10 });
  ok(add2.s >= 400, `같은 기부로 두 번 올리기 막힘 ${add2.s}`);
  const st = (await api(MEMBER, "/api/donate")).j.mine.find((r) => r.id === d1.j.id);
  ok(st?.rental_id === itemId, "기부 줄에 장비대여 물건이 이어짐");

  // 4) 옵션 표기 통일: 정보 수정으로 '지능3 마나재생 2' 를 넣어도 '지3마재2'
  const ed = await api(STAFF, `/api/rent/${itemId}`, "PUT", { job: "ranger", level: 27, weapon: "헌터보우", options: "지능3 마나재생 2", enhance: 8, term: "2w", price: 10 });
  item = (await api(MEMBER, "/api/rent")).j.items.find((i) => i.id === itemId);
  ok(ed.s < 300 && item?.options === "지3마재2", `정보 수정 '지능3 마나재생 2' -> '${item?.options}'`);
  await api(STAFF, `/api/rent/${itemId}`, "PUT", { job: "ranger", level: 27, weapon: "헌터보우", options: "명9 민8", enhance: 8, term: "2w", price: 10 });

  // 5) 길드원 신청 -> 수락 -> 대여 완료(마일리지 💎10 보증금) -> 반납(마일리지 돌려받음)
  const ap = await api(MEMBER, "/api/rent/apply", "POST", { items: [itemId], note: "흐름 시험" });
  ok(ap.s < 300, `대여 신청 ${ap.s} ${ap.j?.error ?? ""}`);
  const app = (await api(STAFF, "/api/rent")).j.apps.find((a) => a.requests?.some((q) => q.item_id === itemId || q.itemId === itemId));
  const rid = app?.requests?.find((q) => q.item_id === itemId || q.itemId === itemId)?.rid;
  ok(!!rid, "운영진 신청서에 보임");
  ok((await api(STAFF, `/api/rent/requests/${rid}`, "POST", { action: "accept" })).s === 200, "수락");
  const before = await mileage(MEMBER);
  const hand = await api(STAFF, `/api/rent/requests/${rid}`, "POST", { action: "hand", useDia: 10 });
  ok(hand.s === 200, `대여 완료 (마일리지 💎10) ${hand.s} ${hand.j?.error ?? ""}`);
  ok((await mileage(MEMBER)) === before - 10, "마일리지 -10");
  item = (await api(MEMBER, "/api/rent")).j.items.find((i) => i.id === itemId);
  ok(item?.renter === MEMBER, "대여 중 표시");
  const ret = await api(STAFF, `/api/rent/${itemId}/return`, "POST", {});
  ok(ret.s === 200, `반납 ${ret.s}`);
  ok((await mileage(MEMBER)) === before, "반납하면 마일리지 그대로 돌아옴");

  // 6) 확정한 기부를 지우면 마일리지와 명예의 전당이 같이 준다 (위키에 없는 두 줄)
  await api(STAFF, `/api/donate/${d3.j.id}`, "DELETE");
  ok((await mileage(MEMBER)) === m0 + 15, `기부 지움 -> 마일리지 ${(await mileage(MEMBER)) - m0} (15)`);
  const h2 = await hallOf(MEMBER);
  ok(Math.abs(h2.earned - h0.earned - 15.3) < 1e-6, `명예의 전당 +${(h2.earned - h0.earned).toFixed(2)} (15.3)`);
} finally {
  // 정리: 올린 물건 내리기, 기부 지우기 (마일리지는 기부 지울 때 같이 빠진다. 대여·반납 장부 줄은 남는다)
  for (const id of made.items) if (id) await api(STAFF, `/api/rent/${id}`, "DELETE");
  for (const id of made.donations.reverse()) if (id) await api(STAFF, `/api/donate/${id}`, "DELETE");
  console.log(fail ? `\n${fail}개 실패` : "\n모두 통과");
  process.exitCode = fail ? 1 : 0;
}
