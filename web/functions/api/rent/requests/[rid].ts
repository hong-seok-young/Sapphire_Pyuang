// POST /api/rent/requests/:rid { action, useDia } -> 신청 하나(무기 하나)를 다룬다 (제작자 요청 2026-11-02)
//   accept 수락 (운영진: 차례가 오면 건넨다) / reject 거절 (운영진) / cancel 취소 (신청한 사람)
//   hand 건네줌 (운영진: 게임 안에서 건넨 뒤. 무기가 담당자에게 있어야 한다. useDia: 마일리지에서 쓴 💎, 나머지는 골드로 받은 것으로 장부에)
// 신청한 사람에게 알림. 차례는 선착순이지만 누구에게 먼저 건넬지는 담당자가 정할 수 있다
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";
import { DIA_GOLD, TERM_DAYS, canEnter, dueOf, expectedTimes, isManager, itemLabel, mileageOfName } from "../../../../server/rental";
import type { RentalRow } from "../../../../server/rental";

const md = (ms: number) => {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me)) return FORBIDDEN();
  const rid = Number(Array.isArray(params.rid) ? params.rid[0] : params.rid);
  const b = await readJson<{ action: unknown; useDia: unknown }>(request);
  const req = await env.DB.prepare("SELECT id, item_id, user_id, status, app_id, created_at FROM rental_requests WHERE id = ?")
    .bind(rid)
    .first<{ id: number; item_id: number; user_id: string; status: string; app_id: number | null; created_at: number }>();
  if (!req || (req.status !== "wait" && req.status !== "ok")) return json({ error: "기다리는 신청이 아니에요" }, 404);
  const item = await env.DB.prepare("SELECT * FROM rental_items WHERE id = ?").bind(req.item_id).first<RentalRow>();
  if (!item) return json({ error: "없는 무기예요" }, 404);
  const now = Date.now();
  const touch = req.app_id !== null ? [env.DB.prepare("UPDATE rental_apps SET updated_at = ? WHERE id = ?").bind(now, req.app_id)] : [];

  if (b.action === "cancel") {
    const self = await env.DB.prepare("SELECT 1 FROM users WHERE id = ? AND COALESCE(main_id, id) = ?").bind(req.user_id, me.owner ?? me.id).first();
    if (!self && req.user_id !== me.id) return FORBIDDEN();
    await env.DB.batch([env.DB.prepare("UPDATE rental_requests SET status = 'cancel', done_at = ? WHERE id = ?").bind(now, rid), ...touch]);
    return json({ ok: true });
  }
  if (!isManager(me)) return FORBIDDEN();

  if (b.action === "accept") {
    if (req.status === "ok") return json({ ok: true });
    await env.DB.batch([env.DB.prepare("UPDATE rental_requests SET status = 'ok' WHERE id = ? AND status = 'wait'").bind(rid), ...touch]);
    // 차례에 따라 받을 수 있는 때를 알린다
    const { results: line } = await env.DB.prepare("SELECT id FROM rental_requests WHERE item_id = ? AND status IN ('wait', 'ok') ORDER BY created_at, id")
      .bind(item.id)
      .all<{ id: number }>();
    const pos = line.findIndex((l) => l.id === rid);
    const at = expectedTimes(item, pos + 1, now)[pos];
    const when = at === null ? "앞사람이 반납하면 받아요" : at <= now + 60_000 ? "곧 건네받아요" : `${md(at)}부터 받을 수 있어요`;
    await notify(env, [req.user_id], "rent", `${itemLabel(item)} 신청 수락 · ${when}`, "#/rent", me.id);
    return json({ ok: true });
  }

  if (b.action === "reject") {
    await env.DB.batch([env.DB.prepare("UPDATE rental_requests SET status = 'no', done_at = ?, done_by = ? WHERE id = ?").bind(now, me.id, rid), ...touch]);
    await notify(env, [req.user_id], "rent", `${itemLabel(item)} 신청이 거절됐어요`, "#/rent", me.id);
    return json({ ok: true });
  }

  if (b.action === "hand") {
    if (item.status !== "open") return json({ error: "목록에서 내려간 무기예요" }, 400);
    if (item.renter) return json({ error: `${item.renter} 님이 아직 쓰고 있어요. 먼저 반납을 받아 주세요` }, 409);
    const useDia = Number(b.useDia ?? 0);
    if (!Number.isInteger(useDia) || useDia < 0 || useDia > item.price) return json({ error: "쓸 마일리지가 맞지 않아요" }, 400);
    if (useDia > 0 && useDia > (await mileageOfName(env, req.user_id))) return json({ error: `${req.user_id} 님의 마일리지가 모자라요` }, 400);
    const due = dueOf(item.term, now);
    const took = await env.DB.prepare("UPDATE rental_items SET renter = ?, rented_at = ?, due_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND renter IS NULL")
      .bind(req.user_id, now, due, now, me.id, item.id)
      .run();
    if (!took.meta.changes) return json({ error: "이미 다른 사람이 쓰고 있어요" }, 409);
    await env.DB.batch([
      env.DB.prepare("UPDATE rental_requests SET status = 'done', done_at = ?, done_by = ?, use_dia = ? WHERE id = ?").bind(now, me.id, useDia, rid),
      ...touch,
      ...(useDia > 0
        ? [
            env.DB.prepare("INSERT INTO rental_mileage (who, delta, gold, reason, item_id, note, by_user, created_at) VALUES (?, ?, ?, 'rent', ?, ?, ?, ?)").bind(
              req.user_id, -useDia, (item.price - useDia) * DIA_GOLD, item.id, `${itemLabel(item)} 대여`, me.id, now,
            ),
          ]
        : []),
    ]);
    const next = await env.DB.prepare("SELECT COUNT(*) AS n FROM rental_requests WHERE item_id = ? AND status IN ('wait', 'ok')").bind(item.id).first<{ n: number }>();
    const days = TERM_DAYS[item.term];
    const tail = !days || !due ? "기한 없음" : next?.n ? `다음 신청이 있어서 ${md(due)}에 대여 담당자에게 돌려주세요` : `기한 ${md(due)} · 다음 신청이 없으면 계속 써요`;
    await notify(env, [req.user_id], "rent", `${itemLabel(item)} 건네받았어요 · ${tail}`, "#/rent", me.id);
    return json({ ok: true, dueAt: due });
  }

  return json({ error: "할 일이 맞지 않아요" }, 400);
};
