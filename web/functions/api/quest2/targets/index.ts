// POST /api/quest2/targets { nickname, startLevel, endLevel, note? } -> 지금 라운드에 목표 하나 더하기 (오피서 이상)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_TARGETS_PER_ROUND, activeRound, canManageQuest2, canUseQuest2, readTargetInput } from "../../../../server/quest2";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseQuest2(me) || !canManageQuest2(me.role)) return FORBIDDEN();
  const round = await activeRound(env);
  if (!round) return json({ error: "지금 열린 라운드가 없어요 · 먼저 라운드를 열어 주세요" }, 409);
  const input = readTargetInput(await readJson<Record<string, unknown>>(request));
  if (typeof input === "string") return json({ error: input }, 400);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM quest2_targets WHERE round_id = ?").bind(round.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_TARGETS_PER_ROUND) return json({ error: `목표는 ${MAX_TARGETS_PER_ROUND}개까지예요` }, 409);
  const now = Date.now();
  const row = await env.DB.prepare(
    "INSERT INTO quest2_targets (round_id, nickname, start_level, end_level, note, paid_to_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(round.id, input.nickname, input.startLevel, input.endLevel, input.note, input.startLevel, now, now)
    .first<{ id: number }>();
  if (!row) return json({ error: "넣지 못했어요" }, 500);
  return json({ ok: true, id: row.id }, 201);
};
