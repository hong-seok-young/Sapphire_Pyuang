// POST /api/rent/:id/return -> 반납 (운영진: 게임 안에서 돌려받은 뒤). 담당자에게 돌아와 다음 사람에게 건넬 수 있게 되고, 대여 기록에 돌려받은 때를 적는다.
// 보증금 돌려주기 (제작자 요청 2026-11-02 '보증금 개념이라 반납하면 마일리지와 돈은 다시 돌려받는다'): 대여 완료 때 쓴 마일리지는 장부에 저절로 되돌리고,
// 받은 골드는 담당자가 게임 안에서 돌려준다 (빌린 사람에게 둘 다 알린다). 줄의 첫 사람에게 '돌아왔어요' 알림
import { FORBIDDEN, NEED_LOGIN, currentUser, json, paramId } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";
import { DIA_GOLD, canEnter, isManager, itemLabel, manText } from "../../../../server/rental";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me) || !isManager(me)) return FORBIDDEN();
  const id = Number(paramId(params));
  const now = Date.now();
  const item = await env.DB.prepare("SELECT id, weapon, enhance, price, renter FROM rental_items WHERE id = ? AND status = 'open' AND renter IS NOT NULL")
    .bind(id)
    .first<{ id: number; weapon: string; enhance: number; price: number; renter: string }>();
  if (!item) return json({ error: "대여 중인 물건이 아니에요" }, 404);
  const r = await env.DB.prepare(
    "UPDATE rental_items SET renter = NULL, rented_at = NULL, due_at = NULL, return_req_at = NULL, updated_at = ?, updated_by = ? WHERE id = ? AND renter IS NOT NULL",
  )
    .bind(now, me.id, id)
    .run();
  if (!r.meta.changes) return json({ error: "대여 중인 물건이 아니에요" }, 404);
  // 이번 대여의 보증금 (예전 기록에 골드가 없으면 가격에서 마일리지를 뺀 나머지)
  const lent = await env.DB.prepare(
    "SELECT id, user_id, use_dia, gold FROM rental_requests WHERE item_id = ? AND status = 'done' AND returned_at IS NULL ORDER BY done_at DESC LIMIT 1",
  )
    .bind(id)
    .first<{ id: number; user_id: string; use_dia: number; gold: number | null }>();
  const who = lent?.user_id ?? item.renter;
  const useDia = lent?.use_dia ?? 0;
  const gold = lent ? (lent.gold ?? (item.price - useDia) * DIA_GOLD) : 0;
  const label = itemLabel(item);
  await env.DB.batch([
    ...(lent ? [env.DB.prepare("UPDATE rental_requests SET returned_at = ? WHERE id = ?").bind(now, lent.id)] : []),
    ...(useDia > 0
      ? [
          env.DB.prepare("INSERT INTO rental_mileage (who, delta, gold, reason, item_id, note, by_user, created_at) VALUES (?, ?, ?, 'return', ?, ?, ?, ?)").bind(
            who, useDia, gold, id, label, me.id, now,
          ),
        ]
      : []),
  ]);
  const back = [useDia ? `마일리지 💎${useDia}는 돌려받았고` : "", gold ? `골드 ${manText(gold)}은 담당자에게 돌려받아요` : ""].filter(Boolean).join(" ");
  await notify(env, [who], "rent", `${label} 반납 완료${back ? ` · ${back}` : ""}`, "#/rent?v=apps", me.id);
  const first = await env.DB.prepare("SELECT user_id FROM rental_requests WHERE item_id = ? AND status IN ('wait', 'ok') ORDER BY created_at, id LIMIT 1")
    .bind(id)
    .first<{ user_id: string }>();
  if (first) await notify(env, [first.user_id], "rent", `${label} 이 담당자에게 돌아왔어요 · 곧 받아요`, "#/rent?v=apps", me.id);
  return json({ ok: true, refund: { dia: useDia, gold } });
};
