// POST /api/rent/:id/lend { renter, useDia, date } -> 직접 대여 (운영진: 카카오톡 등 앱 밖에서 받은 신청을 게임 안에서 건넨 뒤 닉네임으로 적는다)
// date 'YYYY-MM-DD' 면 그날 빌려 간 것으로. 마일리지를 쓰면 장부에서 빼고 남은 값은 골드로 받은 것으로 적는다. 앱의 줄은 그대로 둔다 (담당자 판단).
// 앱에서 신청한 사람에게 건넬 때는 신청서의 '건네줌' (/api/rent/requests/:rid hand)
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
  const b = await readJson<{ renter: unknown; useDia: unknown; date: unknown }>(request);
  const item = await env.DB.prepare("SELECT * FROM rental_items WHERE id = ? AND status = 'open'").bind(id).first<RentalRow>();
  if (!item) return json({ error: "없는 물건이에요" }, 404);
  if (item.renter) return json({ error: "이미 대여 중이에요" }, 409);

  const now = Date.now();
  const renter = typeof b.renter === "string" ? b.renter.trim() : "";
  const useDia = Number(b.useDia ?? 0);
  if (!renter || renter.length > 20) return json({ error: "빌려 갈 사람 닉네임을 적어 주세요" }, 400);
  if (!Number.isInteger(useDia) || useDia < 0 || useDia > item.price) return json({ error: "쓸 마일리지가 맞지 않아요" }, 400);
  const m = typeof b.date === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(b.date) : null;
  const at = m ? Math.min(now, Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 9 * 3_600_000) : now;
  if (useDia > 0 && useDia > (await mileageOfName(env, renter))) return json({ error: `${renter} 님의 마일리지가 모자라요` }, 400);

  // 먼저 물건을 잡는다 (둘이 같이 눌러도 하나만)
  const due = dueOf(item.term, at);
  const took = await env.DB.prepare("UPDATE rental_items SET renter = ?, rented_at = ?, due_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND renter IS NULL")
    .bind(renter, at, due, now, me.id, id)
    .run();
  if (!took.meta.changes) return json({ error: "이미 대여 중이에요" }, 409);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO rental_requests (item_id, user_id, use_dia, status, created_at, done_at, done_by) VALUES (?, ?, ?, 'done', ?, ?, ?)").bind(
      id, renter, useDia, at, at, me.id,
    ),
    ...(useDia > 0
      ? [
          env.DB.prepare("INSERT INTO rental_mileage (who, delta, gold, reason, item_id, note, by_user, created_at) VALUES (?, ?, ?, 'rent', ?, ?, ?, ?)").bind(
            renter, -useDia, (item.price - useDia) * DIA_GOLD, id, `${itemLabel(item)} 대여`, me.id, now,
          ),
        ]
      : []),
  ]);
  await notify(env, [renter], "rent", `${itemLabel(item)} 대여됐어요${due ? ` · 기한 ${day(due)} (다음 신청이 있으면 그날 담당자에게 돌려주세요)` : ""}`, "#/rent", me.id);
  return json({ ok: true, dueAt: due });
};
