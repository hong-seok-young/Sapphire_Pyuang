// POST /api/rent/:id/request { useDia, note } -> 대여 신청 (마일리지에서 쓸 💎, 나머지는 골드). 운영진에게 알림
// DELETE /api/rent/:id/request -> 내 신청 취소
// 한 사람(묶은 캐릭터 모두)이 같은 물건에는 하나, 모두 합쳐 3개까지 기다릴 수 있다
import { FORBIDDEN, NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { DIA_GOLD, MAX_WAIT, canEnter, itemLabel, mileageOf, notifyManagers } from "../../../../server/rental";
import type { RentalRow } from "../../../../server/rental";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me)) return FORBIDDEN();
  const id = Number(paramId(params));
  const owner = me.owner ?? me.id;
  const b = await readJson<{ useDia: unknown; note: unknown }>(request);
  const useDia = Number(b.useDia ?? 0);
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 100) : "";
  const item = await env.DB.prepare("SELECT * FROM rental_items WHERE id = ? AND status = 'open'").bind(id).first<RentalRow>();
  if (!item) return json({ error: "없는 물건이에요" }, 404);
  if (item.renter) return json({ error: "지금 대여 중인 물건이에요" }, 409);
  if (!Number.isInteger(useDia) || useDia < 0 || useDia > item.price) return json({ error: "쓸 마일리지가 맞지 않아요" }, 400);
  const [dup, count] = await env.DB.batch([
    env.DB.prepare(
      "SELECT 1 FROM rental_requests WHERE item_id = ?1 AND status = 'wait' AND user_id IN (SELECT id FROM users WHERE id = ?2 OR main_id = ?2)",
    ).bind(id, owner),
    env.DB.prepare("SELECT COUNT(*) AS n FROM rental_requests WHERE status = 'wait' AND user_id IN (SELECT id FROM users WHERE id = ?1 OR main_id = ?1)").bind(owner),
  ]);
  if (dup.results.length) return json({ error: "이미 신청한 물건이에요" }, 409);
  if (((count.results[0] as { n: number } | undefined)?.n ?? 0) >= MAX_WAIT) return json({ error: `신청은 ${MAX_WAIT}개까지 기다릴 수 있어요` }, 400);
  if (useDia > 0 && useDia > (await mileageOf(env, owner))) return json({ error: "마일리지가 모자라요" }, 400);
  await env.DB.prepare("INSERT INTO rental_requests (item_id, user_id, use_dia, note, status, created_at) VALUES (?, ?, ?, ?, 'wait', ?)")
    .bind(id, me.id, useDia, note || null, Date.now())
    .run();
  const gold = (item.price - useDia) * DIA_GOLD;
  await notifyManagers(
    env,
    `대여 신청: ${me.id} · ${itemLabel(item)} 💎${item.price}${useDia ? ` (마일리지 💎${useDia}, 골드 ${(gold / 10_000).toLocaleString()}만)` : ""}${note ? ` · ${note}` : ""}`,
    me.id,
  );
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me)) return FORBIDDEN();
  const id = Number(paramId(params));
  const owner = me.owner ?? me.id;
  const r = await env.DB.prepare(
    "UPDATE rental_requests SET status = 'cancel', done_at = ?1 WHERE item_id = ?2 AND status = 'wait' AND user_id IN (SELECT id FROM users WHERE id = ?3 OR main_id = ?3)",
  )
    .bind(Date.now(), id, owner)
    .run();
  if (!r.meta.changes) return json({ error: "기다리는 신청이 없어요" }, 404);
  return json({ ok: true });
};
