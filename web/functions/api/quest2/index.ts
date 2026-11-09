// GET /api/quest2 -> 2군 성장 퀘스트 (server/quest2.ts, src/pages/Quest2.tsx)
//   { open, canManage, round, brackets, targets: [{ id, nickname, startLevel, endLevel, note, currentLevel, doneAlready, mine, done, claim }],
//     pendingClaims (canManage 일 때만) }
import { FORBIDDEN, NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { PAYOUT_NOTE, QUEST2_OPEN, activeRound, canManageQuest2, canUseQuest2, completionCount, levelOf, readBrackets } from "../../../server/quest2";
import type { ClaimRow, TargetRow } from "../../../server/quest2";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseQuest2(me)) return FORBIDDEN();
  const manage = canManageQuest2(me.role);
  const mine = new Set(me.chars ?? [me.id]);

  const round = await activeRound(env);
  const brackets = await readBrackets(env);
  if (!round) return json({ open: QUEST2_OPEN, canManage: manage, round: null, brackets, targets: [], payoutNote: PAYOUT_NOTE, pendingClaims: manage ? [] : undefined });

  const { results: targets } = await env.DB.prepare("SELECT * FROM quest2_targets WHERE round_id = ? ORDER BY start_level ASC, id ASC").bind(round.id).all<TargetRow>();
  const { results: claims } = await env.DB.prepare(
    "SELECT * FROM quest2_claims WHERE target_id IN (SELECT id FROM quest2_targets WHERE round_id = ?) ORDER BY requested_at DESC",
  )
    .bind(round.id)
    .all<ClaimRow>();
  const liveByTarget = new Map<number, ClaimRow>();
  const doneByTarget = new Set<number>();
  for (const c of claims) {
    if (c.status !== "rejected") doneByTarget.add(c.target_id); // 신청 중이거나 이미 지급된 완주는 다시 신청 못 하게
    if (c.status === "pending" && !liveByTarget.has(c.target_id)) liveByTarget.set(c.target_id, c);
  }

  const out = await Promise.all(
    targets.map(async (t) => {
      const currentLevel = await levelOf(env, t.nickname);
      const doneAlready = t.start_level === t.end_level;
      const done = !doneAlready && currentLevel !== null && currentLevel >= t.end_level;
      const pending = liveByTarget.get(t.id);
      return {
        id: t.id,
        nickname: t.nickname,
        startLevel: t.start_level,
        endLevel: t.end_level,
        note: t.note,
        currentLevel,
        doneAlready,
        done,
        mine: mine.has(t.nickname),
        claimed: doneByTarget.has(t.id) && !pending,
        pending: pending ? { id: pending.id, reward: pending.reward, doping: !!pending.doping, note: pending.note, requestedAt: pending.requested_at } : null,
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
      rank: c.rank,
      reward: c.reward,
      doping: !!c.doping,
      note: c.note,
      requestedAt: c.requested_at,
    }));
  }

  return json({
    open: QUEST2_OPEN,
    canManage: manage,
    round: {
      id: round.id,
      title: round.title,
      note: round.note,
      startsAt: round.starts_at,
      endsAt: round.ends_at,
      bonusSlots: round.bonus_slots,
      bonusReward: round.bonus_reward,
      standardReward: round.standard_reward,
      completed: await completionCount(env, round.id),
    },
    brackets: brackets.map((b) => ({ id: b.id, minLevel: b.min_level, maxLevel: b.max_level, note: b.note })),
    targets: out,
    payoutNote: PAYOUT_NOTE,
    pendingClaims,
  });
};
