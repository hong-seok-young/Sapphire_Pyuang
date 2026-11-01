// POST /api/rent/:id/return -> 반납 (운영진: 게임 안에서 돌려받은 뒤). 다시 대여 가능이 되고, 대여 기록에 돌려받은 때를 적는다
import { FORBIDDEN, NEED_LOGIN, currentUser, json, paramId } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { canEnter, isManager } from "../../../../server/rental";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me) || !isManager(me)) return FORBIDDEN();
  const id = Number(paramId(params));
  const now = Date.now();
  const r = await env.DB.prepare(
    "UPDATE rental_items SET renter = NULL, rented_at = NULL, due_at = NULL, updated_at = ?, updated_by = ? WHERE id = ? AND status = 'open' AND renter IS NOT NULL",
  )
    .bind(now, me.id, id)
    .run();
  if (!r.meta.changes) return json({ error: "대여 중인 물건이 아니에요" }, 404);
  await env.DB.prepare(
    "UPDATE rental_requests SET returned_at = ? WHERE id = (SELECT id FROM rental_requests WHERE item_id = ? AND status = 'done' AND returned_at IS NULL ORDER BY done_at DESC LIMIT 1)",
  )
    .bind(now, id)
    .run();
  return json({ ok: true });
};
