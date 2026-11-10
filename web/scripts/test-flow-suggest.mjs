// 건의 결재선 흐름 시험 (제작자 2026-11-10 '오피서 합의 -> 길마 결재 -> 건의 접수 완료 -> 건의 반영 완료, 길마 직권, 올린 사람에게 알림'. CLAUDE.md '연동 기능은 흐름 시험').
// 로컬 서버에만: BASE=http://127.0.0.1:8788 PW=<로컬 비밀번호> MEMBER=테스트1 OFFICER=멍멍 OFFICER2=유어아너 MASTER=마을모금함 node scripts/test-flow-suggest.mjs
const BASE = process.env.BASE || "http://127.0.0.1:8788";
const PW = process.env.PW || "test1234";
const MEMBER = process.env.MEMBER || "테스트1";
const OFFICER = process.env.OFFICER || "멍멍";
const OFFICER2 = process.env.OFFICER2 || "유어아너";
const MASTER = process.env.MASTER || "마을모금함";
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
  if (!c) throw new Error(`로그인 못 함: ${id} ${r.status}`);
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
const act = (id, post, a, note = "") => api(id, `/api/board/${post}/suggest`, "POST", { act: a, note });
const flow = async (post) => (await api(MASTER, `/api/board/${post}`)).j.flow;
const lastAlert = async (id, re) => ((await api(id, "/api/alerts")).j.alerts ?? []).find((a) => re.test(a.text));

for (const u of [MEMBER, OFFICER, OFFICER2, MASTER]) await login(u);
const made = [];
const post = async (who, title, anon = false) => {
  const r = await api(who, "/api/board", "POST", { cat: "suggest", title, body: "흐름 시험", anon });
  made.push([who, r.j.id]);
  return r.j.id;
};
try {
  // 1) 접수 -> 오피서 합의 -> 길마 결재 -> 접수 완료 -> 반영 완료
  const A = await post(MEMBER, "결재 시험 A", true);
  ok((await flow(A)).status === "agree", "접수하면 오피서 합의 대기");
  ok((await api(MEMBER, "/api/board?cat=suggest&mine=1")).j.posts.find((p) => p.id === A)?.sg === "agree", "내 건의함에 '합의 대기'");
  ok(!!(await lastAlert(OFFICER, /\[건의 접수 · 오피서 합의\] 결재 시험 A · 익명/)), "오피서에게 합의 차례 알림 (익명)");
  ok((await act(MEMBER, A, "agree")).s === 403, "길드원은 결재 못 함");
  ok((await act(MASTER, A, "approve")).s === 409, "합의 없이 결재는 막힘 (직권 결재는 따로)");
  ok((await act(OFFICER, A, "reject")).s === 400, "의견 없는 반려는 막힘");
  ok((await act(OFFICER, A, "agree", "좋은 의견")).s === 200, "오피서 합의");
  ok((await act(OFFICER, A, "agree")).s === 409, "같은 오피서 두 번 합의 막힘");
  ok((await api(MEMBER, "/api/board?cat=suggest&mine=1")).j.posts.find((p) => p.id === A)?.sgAgrees === 1, "내 건의함에 합의 1 (결재 대기)");
  ok(!!(await lastAlert(MEMBER, new RegExp(`${OFFICER} 님이 합의했어요`))), "올린 사람에게 합의 알림");
  ok(!!(await lastAlert(MASTER, /\[길마 결재\]/)), "길마에게 결재 차례 알림");
  ok((await act(MASTER, A, "skip")).s === 409, "합의가 있으면 직권 결재 대신 결재");
  ok((await act(MASTER, A, "approve", "반영합시다")).s === 200 && (await flow(A)).status === "accepted", "길마 결재 -> 접수 완료");
  ok(!!(await lastAlert(MEMBER, /\[건의 접수 완료\] 건의가 받아들여졌어요/)), "올린 사람에게 접수 완료 알림");
  ok((await act(MEMBER, A, "done")).s === 403, "반영 완료는 운영진만");
  ok((await act(OFFICER2, A, "done", "다음 패치에 넣었어요")).s === 200 && (await flow(A)).status === "done", "다른 오피서가 반영 완료");
  ok(!!(await lastAlert(MEMBER, /\[건의 반영 완료\]/)), "올린 사람에게 반영 완료 알림");
  const steps = (await flow(A)).steps.map((s) => s.kind).join(",");
  ok(steps === "agree,approve,done", `결재 이력 ${steps}`);

  // 2) 길마 직권 결재 (오피서 합의 없이)
  const B = await post(MEMBER, "결재 시험 B");
  ok((await act(MASTER, B, "skip", "바로 합니다")).s === 200 && (await flow(B)).status === "accepted", "길마 직권 결재 -> 접수 완료");

  // 3) 오피서 반려 -> 길마 강제 결재
  const C = await post(MEMBER, "결재 시험 C");
  ok((await act(OFFICER, C, "reject", "지금은 어려워요")).s === 200 && (await flow(C)).status === "rejected", "오피서 반려");
  ok(!!(await lastAlert(MEMBER, /\[건의 반려\] “결재 시험 C” · 지금은 어려워요/)), "올린 사람에게 반려 알림 (의견)");
  ok((await act(OFFICER, C, "force")).s === 403, "강제 결재는 길마만");
  ok((await act(MASTER, C, "force", "그래도 합니다")).s === 200 && (await flow(C)).status === "accepted", "길마 강제 결재 -> 접수 완료");
  ok(!!(await lastAlert(OFFICER, /\[강제 결재\] 반려하신 건의를/)), "반려한 오피서에게 강제 결재 알림");

  // 4) 오피서는 자기 건의에 합의 못 함, 길드원은 남의 건의를 못 봄
  const D = await post(OFFICER, "결재 시험 D");
  ok((await act(OFFICER, D, "agree")).s === 409, "자기 건의에 합의 막힘");
  ok((await act(MEMBER, D, "agree")).s === 404, "길드원은 남의 건의를 못 봄");
  const inbox = (await api(OFFICER2, "/api/board?cat=suggest")).j.posts.map((p) => `${p.id}:${p.sg}`);
  ok(inbox.includes(`${A}:done`) && inbox.includes(`${B}:accepted`) && inbox.includes(`${D}:agree`), "접수함에 상태가 보임");
} finally {
  for (const [who, id] of made) if (id) await api(who, `/api/board/${id}`, "DELETE");
  console.log(fail ? `\n${fail}개 실패` : "\n모두 통과");
  process.exitCode = fail ? 1 : 0;
}
