// POST /api/rent/requests/:rid { action: "reject" } -> 대여 신청 거절 (운영진). 신청한 사람에게 알림
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";
import { canEnter, isManager, itemLabel } from "../../../../server/rental";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me) || !isManager(me)) return FORBIDDEN();
  const rid = Number(Array.isArray(params.rid) ? params.rid[0] : params.rid);
  const b = await readJson<{ action: unknown }>(request);
  if (b.action !== "reject") return json({ error: "할 일이 맞지 않아요" }, 400);
  const req = await env.DB.prepare(
    "SELECT r.id, r.user_id, i.weapon, i.enhance FROM rental_requests r JOIN rental_items i ON i.id = r.item_id WHERE r.id = ? AND r.status = 'wait'",
  )
    .bind(rid)
    .first<{ id: number; user_id: string; weapon: string; enhance: number }>();
  if (!req) return json({ error: "기다리는 신청이 아니에요" }, 404);
  await env.DB.prepare("UPDATE rental_requests SET status = 'no', done_at = ?, done_by = ? WHERE id = ? AND status = 'wait'").bind(Date.now(), me.id, rid).run();
  await notify(env, [req.user_id], "rent", `${itemLabel(req)} 대여 신청이 거절됐어요`, "#/rent", me.id);
  return json({ ok: true });
};
