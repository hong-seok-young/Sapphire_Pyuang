// PUT /api/gd/avail { slots } -> 내 이번 주 가능한 때 ('0'/'1' 336자, server/gdungeon.ts).
// 내가 칠해서 파티원이 모두 칠하게 되면 파티원에게 1번 후보를 알린다
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canSeeParties, canUseGd, cleanBits, oneParty, partyIdOf, slotText, tellParty, weeks } from "../../../server/gdungeon";

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!(await canUseGd(env, me))) return FORBIDDEN();
  const slots = cleanBits((await readJson<{ slots: unknown }>(request)).slots);
  if (!slots) return json({ error: "시간표가 맞지 않아요" }, 400);
  const now = Date.now();
  const { week } = weeks(now);
  const partyId = await partyIdOf(env, me.id);
  const before = partyId ? await oneParty(env, partyId, week, now) : null;
  await env.DB.prepare(
    "INSERT INTO gd_avail (user_id, week, slots, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(user_id, week) DO UPDATE SET slots = ?3, updated_at = ?4",
  )
    .bind(me.id, week, slots, now)
    .run();
  if (!partyId || !before) return json({ ok: true });
  const after = await oneParty(env, partyId, week, now);
  // 마지막으로 칠한 사람이 나: 모두 모였다고 알린다 (한 번만, 처음 모였을 때)
  if (after && !before.members.every((m) => m.filled) && after.members.every((m) => m.filled)) {
    const text =
      after.current !== null
        ? `시간표가 다 모였어요 · 1번 후보 ${slotText(week, after.current)} · 확정이나 불참을 눌러 주세요`
        : "시간표가 다 모였는데 교집합이 없어요 · 시간표를 더 칠해 주세요";
    await tellParty(env, after, `[${after.name}] ${text}`, me.id);
  }
  // 파티 명단을 숨긴 동안은 길드원에게 내 파티 상태를 돌려주지 않는다 (시간표는 저장된다)
  return json({ ok: true, party: canSeeParties(me) ? after : null });
};
