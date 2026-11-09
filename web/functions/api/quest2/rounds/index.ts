// POST /api/quest2/rounds { title, note?, bonusSlots?, bonusReward?, standardReward?, targets: [{ nickname, startLevel, endLevel, note? }] } -> 오피서 이상.
//   새 라운드를 열고(이전 라운드는 active=0) 목표·보상 글을 한 번에 넣는다 (격주로 새 목표 목록을 올릴 때 코드를 고치지 않고 쓴다)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { canManageQuest2, canUseQuest2, readRoundInput } from "../../../../server/quest2";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseQuest2(me) || !canManageQuest2(me.role)) return FORBIDDEN();
  const input = readRoundInput(await readJson<Record<string, unknown>>(request));
  if (typeof input === "string") return json({ error: input }, 400);
  const now = Date.now();
  await env.DB.prepare("UPDATE quest2_rounds SET active = 0 WHERE active = 1").run();
  const round = await env.DB.prepare(
    "INSERT INTO quest2_rounds (title, note, starts_at, bonus_slots, bonus_reward, standard_reward, active, created_by, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id",
  )
    .bind(input.title, input.note, now, input.bonusSlots, input.bonusReward, input.standardReward, me.id, now)
    .first<{ id: number }>();
  if (!round) return json({ error: "라운드를 열지 못했어요" }, 500);
  await env.DB.batch(
    input.targets.map((t) =>
      env.DB.prepare(
        "INSERT INTO quest2_targets (round_id, nickname, start_level, end_level, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(round.id, t.nickname, t.startLevel, t.endLevel, t.note, now, now),
    ),
  );
  return json({ ok: true, roundId: round.id }, 201);
};
