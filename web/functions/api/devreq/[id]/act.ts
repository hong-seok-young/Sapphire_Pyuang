// POST /api/devreq/:id/act { act, note? } -> 결재선 (server/devreq.ts)
//   feasible  앱개발자: 개발 검토(review) -> 합의·결재 대기(agree). 오피서들에게 합의 차례 알림
//   agree     오피서: 합의 (이번 차례 한 번, 자기 요청은 안 됨). 처음 합의면 길드마스터에게 결재 차례 알림
//   approve   길드마스터: 합의가 1명 이상이면 최종 결재 -> 개발 중(dev). 앱개발자에게 알림
//   reject    검토 중엔 앱개발자, 합의·결재 대기엔 오피서·길드마스터: 반려 의견을 꼭 적는다 -> rejected (신청한 사람이 고쳐서 다시 신청)
//   done      앱개발자: 개발 중 -> 완료. 신청한 사람(과 특정 인원)에게 알림
// note 는 결재 의견 ('이렇게 만들어 달라', 반려 까닭). 이력은 지우지 않는다
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { agreesOf, canUseDevReq, ownerSame, readNote, roleOf, shortOf, tell } from "../../../../server/devreq";
import type { DevReqRow, Status, StepKind } from "../../../../server/devreq";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDevReq(me)) return FORBIDDEN();
  const row = await env.DB.prepare("SELECT * FROM dev_requests WHERE id = ?").bind(Number(params.id)).first<DevReqRow>();
  if (!row) return json({ error: "없는 요청이에요" }, 404);
  const b = await readJson<{ act: unknown; note: unknown }>(request);
  const note = readNote(b.note);
  const role = roleOf(me);
  const q = `“${shortOf(row.body)}”`;
  let next: Status;
  let kind: StepKind;
  const after: (() => Promise<void>)[] = [];

  if (b.act === "feasible") {
    if (!role.dev) return FORBIDDEN();
    if (row.status !== "review") return json({ error: "검토 중인 요청이 아니에요" }, 409);
    next = "agree";
    kind = "feasible";
    after.push(
      () => tell(env, me, ["owner"], row, `개발 가능 판정 · ${q} · 이제 합의와 길마 결재를 기다려요`),
      () => tell(env, me, ["officer"], row, `개발 요청 합의 차례예요 · ${row.user_id}: ${q}`),
    );
  } else if (b.act === "agree") {
    if (!role.agree) return FORBIDDEN();
    if (row.status !== "agree") return json({ error: "합의할 차례가 아니에요" }, 409);
    if (ownerSame(me, row)) return json({ error: "내 요청에는 합의할 수 없어요" }, 409);
    const agrees = await agreesOf(env, row);
    if (agrees.includes(me.id)) return json({ error: "이미 합의했어요" }, 409);
    next = "agree";
    kind = "agree";
    after.push(() => tell(env, me, ["owner"], row, `${me.id} 님이 합의했어요 · ${q}${note ? ` · ${note}` : ""}`));
    if (!agrees.length) after.push(() => tell(env, me, ["master"], row, `개발 요청 결재 차례예요 · ${row.user_id}: ${q}`));
  } else if (b.act === "approve") {
    if (!role.approve) return FORBIDDEN();
    if (row.status !== "agree") return json({ error: "결재할 차례가 아니에요" }, 409);
    if (!(await agreesOf(env, row)).length) return json({ error: "합의가 한 명 이상 있어야 결재할 수 있어요" }, 409);
    next = "dev";
    kind = "approve";
    after.push(
      () => tell(env, me, ["owner"], row, `길드마스터 결재 완료 · 개발을 시작해요 · ${q}`),
      () => tell(env, me, ["developer"], row, `결재 완료 · 개발해 주세요 · ${q}${note ? ` · ${note}` : ""}`),
    );
  } else if (b.act === "reject") {
    const may = row.status === "review" ? role.dev : row.status === "agree" ? role.agree || role.approve : false;
    if (!may) return row.status === "review" || row.status === "agree" ? FORBIDDEN() : json({ error: "반려할 수 있는 때가 아니에요" }, 409);
    if (!note) return json({ error: "반려 의견을 적어 주세요 (신청한 사람이 보고 고쳐요)" }, 400);
    next = "rejected";
    kind = "reject";
    after.push(() => tell(env, me, ["owner"], row, `개발 요청이 반려됐어요 · ${q} · ${note} · 고쳐서 다시 신청할 수 있어요`));
  } else if (b.act === "done") {
    if (!role.dev) return FORBIDDEN();
    if (row.status !== "dev") return json({ error: "개발 중인 요청이 아니에요" }, 409);
    next = "done";
    kind = "done";
    const people = row.people ? (JSON.parse(row.people) as string[]) : [];
    after.push(() => tell(env, me, ["owner", ...people], row, `개발 완료 · ${q}${note ? ` · ${note}` : ""}`));
  } else return json({ error: "모르는 결재예요" }, 400);

  const now = Date.now();
  // 같은 때 두 사람이 누르면 먼저 바꾼 쪽만 (상태가 그대로일 때만 바꾼다)
  const upd = await env.DB.prepare("UPDATE dev_requests SET status = ?, updated_at = ? WHERE id = ? AND status = ? AND round = ?")
    .bind(next, now, row.id, row.status, row.round)
    .run();
  if (!upd.meta.changes) return json({ error: "그새 다른 사람이 결재했어요. 새로고침해 주세요" }, 409);
  await env.DB.prepare("INSERT INTO dev_request_steps (req_id, round, user_id, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(row.id, row.round, me.id, kind, note || null, now)
    .run();
  for (const f of after) await f();
  return json({ ok: true, status: next });
};
