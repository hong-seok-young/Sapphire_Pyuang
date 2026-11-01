// PUT /api/rent/:id { job, level, weapon, options, enhance, term, price, donor, note } -> 물건 고치기 (운영진)
// DELETE /api/rent/:id -> 목록에서 내리기 (운영진. 기록은 남기고 status 'gone', 기다리던 신청은 거절하고 알린다)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import { canEnter, checkItem, isManager, itemLabel } from "../../../server/rental";
import type { RentalRow } from "../../../server/rental";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me) || !isManager(me)) return FORBIDDEN();
  const id = Number(paramId(params));
  const checked = checkItem(await readJson<Record<string, unknown>>(request));
  if ("error" in checked) return json({ error: checked.error }, 400);
  const it = checked.item;
  const r = await env.DB.prepare(
    "UPDATE rental_items SET job = ?, level = ?, weapon = ?, options = ?, enhance = ?, term = ?, price = ?, donor = ?, note = ?, updated_at = ?, updated_by = ? " +
      "WHERE id = ? AND status = 'open'",
  )
    .bind(it.job, it.level, it.weapon, it.options, it.enhance, it.term, it.price, it.donor, it.note, Date.now(), me.id, id)
    .run();
  if (!r.meta.changes) return json({ error: "없는 물건이에요" }, 404);
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me) || !isManager(me)) return FORBIDDEN();
  const id = Number(paramId(params));
  const item = await env.DB.prepare("SELECT * FROM rental_items WHERE id = ? AND status = 'open'").bind(id).first<RentalRow>();
  if (!item) return json({ error: "없는 물건이에요" }, 404);
  if (item.renter) return json({ error: "대여 중인 물건은 반납한 뒤에 내려요" }, 400);
  const now = Date.now();
  const { results: waits } = await env.DB.prepare("SELECT user_id FROM rental_requests WHERE item_id = ? AND status IN ('wait', 'ok')").bind(id).all<{ user_id: string }>();
  await env.DB.batch([
    env.DB.prepare("UPDATE rental_items SET status = 'gone', updated_at = ?, updated_by = ? WHERE id = ?").bind(now, me.id, id),
    env.DB.prepare("UPDATE rental_requests SET status = 'no', done_at = ?, done_by = ? WHERE item_id = ? AND status IN ('wait', 'ok')").bind(now, me.id, id),
  ]);
  if (waits.length) await notify(env, waits.map((w) => w.user_id), "rent", `${itemLabel(item)} 이 대여 목록에서 내려가 신청이 취소됐어요`, "#/rent", me.id);
  return json({ ok: true });
};
