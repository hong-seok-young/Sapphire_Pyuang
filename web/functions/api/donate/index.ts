// GET /api/donate?period=all|month -> 기부함 (server/donate.ts, src/pages/Donate.tsx)
//   { manage, hall: 명예의 전당, lines: 최근 기부 120건, mine: 내 기부(신청 포함), staff?: { pending, store } }
// POST /api/donate { item, qty, enhance, note, gold, who?, confirm? }
//   길드원: 기부 신청 (gold 는 내가 적은 가치, 운영진이 고쳐서 확정). 운영진이 confirm 이면 who 의 기부로 바로 확정하고 마일리지를 준다
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canManageDonate, canUseDonate, donateLabel, goldText, hallOfFame, notifyDonateStaff, notifyDonor, readDonate, syncDia } from "../../../server/donate";
import type { DonateRow } from "../../../server/donate";

/** 한국 시간 이번 달 1일 0시 */
function monthStart(now = Date.now()): number {
  const d = new Date(now + 9 * 3_600_000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 9 * 3_600_000;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDonate(me)) return FORBIDDEN();
  const period = new URL(request.url).searchParams.get("period") === "month" ? "month" : "all";
  const manage = canManageDonate(me);
  const chars = me.chars ?? [me.id];
  const [hall, mine, pending, store] = await Promise.all([
    hallOfFame(env, period === "month" ? monthStart() : 0),
    env.DB.prepare(
      `SELECT * FROM donate_items WHERE who IN (SELECT value FROM json_each(?)) AND status != 'removed' ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(JSON.stringify(chars))
      .all<DonateRow>(),
    manage ? env.DB.prepare("SELECT * FROM donate_items WHERE status = 'request' ORDER BY created_at").all<DonateRow>() : null,
    manage
      ? env.DB.prepare("SELECT * FROM donate_items WHERE status = 'done' ORDER BY COALESCE(done_at, created_at) DESC LIMIT 300").all<DonateRow>()
      : null,
  ]);
  return json({
    manage,
    period,
    hall: hall.rows,
    lines: hall.lines.slice(0, 120),
    mine: mine.results,
    ...(manage ? { staff: { pending: pending?.results ?? [], store: store?.results ?? [] } } : {}),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDonate(me)) return FORBIDDEN();
  const b = await readJson<Record<string, unknown>>(request);
  const v = readDonate(b);
  if ("error" in v) return json({ error: v.error }, 400);
  const now = Date.now();
  const label = donateLabel(v);

  // 운영진이 직접 적기 (제작자 '운영진이 직접 적을 수도 있게')
  if (b.confirm === true) {
    if (!canManageDonate(me)) return FORBIDDEN();
    const who = typeof b.who === "string" ? b.who.trim() : "";
    if (!who || who.length > 20) return json({ error: "기부한 사람을 적어 주세요" }, 400);
    if (v.gold === null) return json({ error: "골드 가치를 적어 주세요" }, 400);
    const r = await env.DB.prepare(
      "INSERT INTO donate_items (who, item, qty, enhance, note, gold, status, created_at, created_by, done_at, done_by) VALUES (?, ?, ?, ?, ?, ?, 'done', ?, ?, ?, ?)",
    )
      .bind(who, v.item, v.qty, v.enhance, v.note, v.gold, now, me.id, now, me.id)
      .run();
    const id = Number(r.meta.last_row_id);
    const s = await syncDia(env, who, id, label, me.id);
    await notifyDonor(
      env,
      who,
      `🎁 기부 확정 · ${label} ${goldText(v.gold)} 골드${s.diff ? ` · 마일리지 💎+${s.diff}` : ""} · 지금 💎${s.mileage}`,
      me.id,
    );
    return json({ id, dia: s.diff, mileage: s.mileage });
  }

  // 길드원 기부 신청 (제작자 '길드원이 웹으로 기부 신청해도 되고', '골드 가치도 기부하는 사람이 적어서 주면 운영진이 수정할 수 있게')
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM donate_items WHERE created_by = ? AND status = 'request'").bind(me.id).first<{ n: number }>();
  if ((open?.n ?? 0) >= 30) return json({ error: "확인을 기다리는 기부가 너무 많아요 (30개)" }, 400);
  const r = await env.DB.prepare(
    "INSERT INTO donate_items (who, item, qty, enhance, note, gold_ask, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 'request', ?, ?)",
  )
    .bind(me.id, v.item, v.qty, v.enhance, v.note, v.gold, now, me.id)
    .run();
  await notifyDonateStaff(env, `🎁 기부 신청 · ${me.id} · ${label}${v.gold !== null ? ` · ${goldText(v.gold)} 골드` : ""}`, me.id);
  return json({ id: Number(r.meta.last_row_id) });
};
