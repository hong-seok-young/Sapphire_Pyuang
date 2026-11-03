// POST /api/gd/confirm -> 내 시간표 '확정' (제작자 2026-11-03 '팀원이 자기 시간표 확정하면 안 한 사람 알림 재촉하자'):
//   gd_avail.confirmed_at 을 적고, 이번 주 처음 확정할 때만 아직 안 칠한 파티원에게 알림 '[○○ 팀] △△ 님이 시간표를 확정했어요 · 내 시간표를 칠해 주세요'.
//   칠한 칸이 없으면 400. 확정을 풀었다 다시 눌러도 다시 보내지 않는다 (한 주에 한 번). 화면의 잠금(localStorage)은 그대로 두고 이 요청만 더 보낸다
import { FORBIDDEN, NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canUseGd, oneParty, partyIdOf, weeks } from "../../../server/gdungeon";
import { notify } from "../../../server/alerts";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!(await canUseGd(env, me))) return FORBIDDEN();
  const now = Date.now();
  const { week } = weeks(now);
  const row = await env.DB.prepare("SELECT slots, confirmed_at FROM gd_avail WHERE user_id = ? AND week = ?")
    .bind(me.id, week)
    .first<{ slots: string; confirmed_at: number | null }>();
  if (!row || !row.slots.includes("1")) return json({ error: "시간표를 먼저 칠해 주세요" }, 400);
  if (row.confirmed_at) return json({ ok: true, nudged: 0 });
  await env.DB.prepare("UPDATE gd_avail SET confirmed_at = ? WHERE user_id = ? AND week = ?").bind(now, me.id, week).run();
  const partyId = await partyIdOf(env, me.id);
  const p = partyId ? await oneParty(env, partyId, week, now) : null;
  const waiting = p ? p.members.filter((m) => !m.filled && m.id !== me.id).map((m) => m.id) : [];
  if (p && waiting.length) await notify(env, waiting, "gdungeon", `[${p.name}] ${me.id} 님이 시간표를 확정했어요 · 내 시간표를 칠해 주세요`, "#/match", me.id);
  return json({ ok: true, nudged: waiting.length });
};
