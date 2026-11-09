// GET /api/quest2 -> 2군 성장 퀘스트 (server/quest2.ts, src/pages/Quest2.tsx)
//   { open, canManage, round, bands, targets: [{ id, nickname, startLevel, endLevel, note, paidToLevel, currentLevel, claimableGold, doping, mine, pending }],
//     pendingClaims (canManage 일 때만: 운영이 처리할 신청 목록) }
import { FORBIDDEN, NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { QUEST2_OPEN, activeRound, canManageQuest2, canUseQuest2, levelOf, levelReward, readBands } from "../../../server/quest2";
import type { ClaimRow, TargetRow } from "../../../server/quest2";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseQuest2(me)) return FORBIDDEN();
  const manage = canManageQuest2(me.role);
  const mine = new Set(me.chars ?? [me.id]);

  const round = await activeRound(env);
  const bands = await readBands(env);
  if (!round) return json({ open: QUEST2_OPEN, canManage: manage, round: null, bands, targets: [], pendingClaims: manage ? [] : undefined });

  const { results: targets } = await env.DB.prepare("SELECT * FROM quest2_targets WHERE round_id = ? ORDER BY start_level ASC, id ASC").bind(round.id).all<TargetRow>();
  const { results: claims } = await env.DB.prepare(
    "SELECT * FROM quest2_claims WHERE target_id IN (SELECT id FROM quest2_targets WHERE round_id = ?) ORDER BY requested_at DESC",
  )
    .bind(round.id)
    .all<ClaimRow>();
  const liveByTarget = new Map<number, ClaimRow>();
  for (const c of claims) if (c.status === "pending" && !liveByTarget.has(c.target_id)) liveByTarget.set(c.target_id, c);

  const out = await Promise.all(
    targets.map(async (t) => {
      const currentLevel = await levelOf(env, t.nickname);
      const cappedLevel = currentLevel === null ? t.paid_to_level : Math.min(currentLevel, t.end_level);
      const claimableGold = levelReward(t.paid_to_level, cappedLevel, bands);
      const pending = liveByTarget.get(t.id);
      return {
        id: t.id,
        nickname: t.nickname,
        startLevel: t.start_level,
        endLevel: t.end_level,
        note: t.note,
        paidToLevel: t.paid_to_level,
        currentLevel,
        claimableGold,
        doneAlready: t.start_level === t.end_level,
        mine: mine.has(t.nickname),
        pending: pending ? { id: pending.id, gold: pending.gold, doping: !!pending.doping, note: pending.note, requestedAt: pending.requested_at } : null,
      };
    }),
  );

  let pendingClaims: unknown[] | undefined;
  if (manage) {
    const { results: pend } = await env.DB.prepare(
      "SELECT c.*, t.nickname AS nickname, t.end_level AS end_level FROM quest2_claims c JOIN quest2_targets t ON t.id = c.target_id " +
        "WHERE c.status = 'pending' AND t.round_id = ? ORDER BY c.requested_at ASC",
    )
      .bind(round.id)
      .all<ClaimRow & { nickname: string }>();
    pendingClaims = pend.map((c) => ({
      id: c.id,
      targetId: c.target_id,
      nickname: c.nickname,
      fromLevel: c.from_level,
      toLevel: c.to_level,
      gold: c.gold,
      doping: !!c.doping,
      note: c.note,
      requestedAt: c.requested_at,
    }));
  }

  return json({
    open: QUEST2_OPEN,
    canManage: manage,
    round: { id: round.id, title: round.title, note: round.note, startsAt: round.startsAt, endsAt: round.endsAt },
    bands,
    targets: out,
    pendingClaims,
  });
};
