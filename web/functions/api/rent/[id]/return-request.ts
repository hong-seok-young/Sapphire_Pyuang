// POST /api/rent/:id/return-request { cancel? } -> 빌린 사람이 '반납 신청' (제작자 요청 2026-11-02: 장비 반납도 신청하게).
// 운영진에게 알림이 가고 '운영 > 장비반납'에 '반납 신청'으로 맨 위에 보인다. 담당자가 게임 안에서 돌려받고 '반납'을 누르면 끝난다 (return.ts 가 비운다).
// cancel 이면 신청을 거둔다. 빌린 사람(묶은 캐릭터 모두)만
import { FORBIDDEN, NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { canEnter, itemLabel, notifyManagers } from "../../../../server/rental";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me)) return FORBIDDEN();
  const id = Number(paramId(params));
  const b = await readJson<{ cancel?: unknown }>(request);
  const owner = me.owner ?? me.id;
  const item = await env.DB.prepare(
    "SELECT id, weapon, enhance, renter, return_req_at FROM rental_items WHERE id = ?1 AND status = 'open' AND renter IN (SELECT id FROM users WHERE id = ?2 OR main_id = ?2)",
  )
    .bind(id, owner)
    .first<{ id: number; weapon: string; enhance: number; renter: string; return_req_at: number | null }>();
  if (!item) return json({ error: "내가 빌린 무기가 아니에요" }, 404);
  const now = Date.now();
  if (b.cancel === true) {
    await env.DB.prepare("UPDATE rental_items SET return_req_at = NULL WHERE id = ?").bind(id).run();
    return json({ ok: true, returnReqAt: null });
  }
  if (item.return_req_at) return json({ ok: true, returnReqAt: item.return_req_at });
  await env.DB.prepare("UPDATE rental_items SET return_req_at = ? WHERE id = ? AND return_req_at IS NULL").bind(now, id).run();
  await notifyManagers(env, `반납 신청: ${item.renter} · ${itemLabel(item)}`, me.id);
  return json({ ok: true, returnReqAt: now });
};
