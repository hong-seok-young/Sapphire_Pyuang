// POST /api/rent/:id/return -> 반납 (운영진: 게임 안에서 돌려받은 뒤). 담당자에게 돌아와 다음 사람에게 건넬 수 있게 되고, 대여 기록에 돌려받은 때를 적는다.
// 줄의 첫 사람에게 '돌아왔어요, 곧 건네받아요' 알림
import { FORBIDDEN, NEED_LOGIN, currentUser, json, paramId } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";
import { canEnter, isManager, itemLabel } from "../../../../server/rental";

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
  const [item, first] = await env.DB.batch([
    env.DB.prepare("SELECT weapon, enhance FROM rental_items WHERE id = ?").bind(id),
    env.DB.prepare("SELECT user_id FROM rental_requests WHERE item_id = ? AND status IN ('wait', 'ok') ORDER BY created_at, id LIMIT 1").bind(id),
  ]);
  const it = item.results[0] as { weapon: string; enhance: number } | undefined;
  const next = first.results[0] as { user_id: string } | undefined;
  if (it && next) await notify(env, [next.user_id], "rent", `${itemLabel(it)} 이 담당자에게 돌아왔어요 · 곧 건네받아요`, "#/rent", me.id);
  return json({ ok: true });
};
