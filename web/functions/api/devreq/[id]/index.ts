// PUT /api/devreq/:id { body, scope, people? } -> 신청한 사람이 고친다. 검토 전(review, 앱개발자가 아직 손대지 않음)이면 고치기만,
//   반려(rejected)면 고쳐서 다시 신청 (review 로, round + 1, 앱개발자에게 알림)
// DELETE /api/devreq/:id -> 신청한 사람이나 앱개발자가 지운다 (결재 이력, 대화까지)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_BODY, canUseDevReq, ownerSame, readBody, readScope, shortOf, tell } from "../../../../server/devreq";
import type { DevReqRow } from "../../../../server/devreq";

const load = (env: Env, id: unknown) => env.DB.prepare("SELECT * FROM dev_requests WHERE id = ?").bind(Number(id)).first<DevReqRow>();

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDevReq(me)) return FORBIDDEN();
  const row = await load(env, params.id);
  if (!row) return json({ error: "없는 요청이에요" }, 404);
  if (!ownerSame(me, row)) return FORBIDDEN();
  const b = await readJson<{ body: unknown; scope: unknown; people: unknown }>(request);
  const body = readBody(b.body);
  if (!body) return json({ error: `무엇이 필요한지 ${MAX_BODY}자 안으로 적어 주세요` }, 400);
  const scope = readScope(b);
  if (typeof scope === "string") return json({ error: scope }, 400);
  const people = scope.people.length ? JSON.stringify(scope.people) : null;
  const now = Date.now();
  if (row.status === "rejected") {
    const round = row.round + 1;
    await env.DB.batch([
      env.DB.prepare("UPDATE dev_requests SET body = ?, scope = ?, people = ?, status = 'review', round = ?, updated_at = ? WHERE id = ? AND status = 'rejected'").bind(
        body,
        scope.scope,
        people,
        round,
        now,
        row.id,
      ),
      env.DB.prepare("INSERT INTO dev_request_steps (req_id, round, user_id, kind, note, created_at) VALUES (?, ?, ?, 'resubmit', NULL, ?)").bind(row.id, round, me.id, now),
    ]);
    await tell(env, me, ["developer"], { ...row, body }, `반려된 개발 요청을 고쳐서 다시 신청했어요 · ${me.id}: “${shortOf(body)}”`);
    return json({ ok: true, resubmitted: true });
  }
  if (row.status !== "review") return json({ error: "검토가 시작된 요청은 고칠 수 없어요 (반려되면 고쳐서 다시 신청해요)" }, 409);
  const done = await env.DB.prepare("SELECT 1 FROM dev_request_steps WHERE req_id = ? AND round = ? AND kind NOT IN ('submit', 'resubmit')").bind(row.id, row.round).first();
  if (done) return json({ error: "검토가 시작된 요청은 고칠 수 없어요" }, 409);
  await env.DB.prepare("UPDATE dev_requests SET body = ?, scope = ?, people = ?, updated_at = ? WHERE id = ?").bind(body, scope.scope, people, now, row.id).run();
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDevReq(me)) return FORBIDDEN();
  const row = await load(env, params.id);
  if (!row) return json({ error: "없는 요청이에요" }, 404);
  if (!ownerSame(me, row) && me.role !== "developer") return FORBIDDEN();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM dev_request_steps WHERE req_id = ?").bind(row.id),
    env.DB.prepare("DELETE FROM dev_request_talk WHERE req_id = ?").bind(row.id),
    env.DB.prepare("DELETE FROM dev_requests WHERE id = ?").bind(row.id),
  ]);
  return json({ ok: true });
};
