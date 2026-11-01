// POST /api/rent/:id/lend { requestId } 또는 { renter, useDia, date } -> 대여 처리 (운영진: 게임 안에서 건넨 뒤)
// 신청을 받아 빌려주거나(그 신청의 마일리지), 카톡 등으로 따로 받은 것을 닉네임으로 바로 적는다 (date 'YYYY-MM-DD' 면 그날 빌려 간 것으로).
// 마일리지를 쓰면 장부에서 빼고(남은 값은 골드로 받은 것으로 적는다), 같은 물건의 다른 신청은 거절하고 알린다
import { FORBIDDEN, NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";
import { DIA_GOLD, canEnter, dueOf, isManager, itemLabel, mileageOfName } from "../../../../server/rental";
import type { RentalRow } from "../../../../server/rental";

const day = (ms: number) => {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me) || !isManager(me)) return FORBIDDEN();
  const id = Number(paramId(params));
  const b = await readJson<{ requestId: unknown; renter: unknown; useDia: unknown; date: unknown }>(request);
  const item = await env.DB.prepare("SELECT * FROM rental_items WHERE id = ? AND status = 'open'").bind(id).first<RentalRow>();
  if (!item) return json({ error: "없는 물건이에요" }, 404);
  if (item.renter) return json({ error: "이미 대여 중이에요" }, 409);

  const now = Date.now();
  let renter: string;
  let useDia: number;
  let requestId: number | null = null;
  let at = now;
  if (b.requestId !== undefined) {
    const req = await env.DB.prepare("SELECT id, user_id, use_dia FROM rental_requests WHERE id = ? AND item_id = ? AND status = 'wait'")
      .bind(Number(b.requestId), id)
      .first<{ id: number; user_id: string; use_dia: number }>();
    if (!req) return json({ error: "기다리는 신청이 아니에요" }, 404);
    renter = req.user_id;
    useDia = req.use_dia;
    requestId = req.id;
  } else {
    renter = typeof b.renter === "string" ? b.renter.trim() : "";
    useDia = Number(b.useDia ?? 0);
    if (!renter || renter.length > 20) return json({ error: "빌려 갈 사람 닉네임을 적어 주세요" }, 400);
    if (!Number.isInteger(useDia) || useDia < 0 || useDia > item.price) return json({ error: "쓸 마일리지가 맞지 않아요" }, 400);
    const m = typeof b.date === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(b.date) : null;
    if (m) at = Math.min(now, Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 9 * 3_600_000);
  }
  if (useDia > 0 && useDia > (await mileageOfName(env, renter))) return json({ error: `${renter} 님의 마일리지가 모자라요` }, 400);

  // 먼저 물건을 잡는다 (둘이 같이 눌러도 하나만)
  const due = dueOf(item.term, at);
  const took = await env.DB.prepare("UPDATE rental_items SET renter = ?, rented_at = ?, due_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND renter IS NULL")
    .bind(renter, at, due, now, me.id, id)
    .run();
  if (!took.meta.changes) return json({ error: "이미 대여 중이에요" }, 409);
  const { results: others } = await env.DB.prepare("SELECT user_id FROM rental_requests WHERE item_id = ? AND status = 'wait' AND id IS NOT ?")
    .bind(id, requestId)
    .all<{ user_id: string }>();
  await env.DB.batch([
    requestId !== null
      ? env.DB.prepare("UPDATE rental_requests SET status = 'done', done_at = ?, done_by = ? WHERE id = ?").bind(at, me.id, requestId)
      : env.DB.prepare("INSERT INTO rental_requests (item_id, user_id, use_dia, status, created_at, done_at, done_by) VALUES (?, ?, ?, 'done', ?, ?, ?)").bind(
          id, renter, useDia, at, at, me.id,
        ),
    env.DB.prepare("UPDATE rental_requests SET status = 'no', done_at = ?, done_by = ? WHERE item_id = ? AND status = 'wait'").bind(now, me.id, id),
    ...(useDia > 0
      ? [
          env.DB.prepare("INSERT INTO rental_mileage (who, delta, gold, reason, item_id, note, by_user, created_at) VALUES (?, ?, ?, 'rent', ?, ?, ?, ?)").bind(
            renter, -useDia, (item.price - useDia) * DIA_GOLD, id, `${itemLabel(item)} 대여`, me.id, now,
          ),
        ]
      : []),
  ]);
  await notify(env, [renter], "rent", `${itemLabel(item)} 대여됐어요${due ? ` · ${day(due)}까지 반납` : ""}`, "#/rent", me.id);
  if (others.length) await notify(env, others.map((o) => o.user_id), "rent", `${itemLabel(item)} 은 다른 길드원에게 대여됐어요`, "#/rent", me.id);
  return json({ ok: true, dueAt: due });
};
