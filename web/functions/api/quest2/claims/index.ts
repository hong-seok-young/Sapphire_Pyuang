// POST /api/quest2/claims { targetId, doping?, note? } -> 보상받기 신청 (쌓인 만큼 한 번에, 신청은 그 캐릭터 본인만).
//   달성한 레벨이 없고 doping 도 아니면 400, 이미 신청이 있으면 409. 오피서에게 알림
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_NOTE, activeRound, canUseQuest2, levelOf, levelReward, notifyOfficers, readBands, text } from "../../../../server/quest2";
import type { TargetRow } from "../../../../server/quest2";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseQuest2(me)) return FORBIDDEN();
  const body = await readJson<{ targetId: unknown; doping: unknown; note: unknown }>(request);
  const targetId = Number(body.targetId);
  if (!Number.isInteger(targetId)) return json({ error: "목표가 맞지 않아요" }, 400);
  const note = text(body.note, MAX_NOTE);
  if (note === undefined) return json({ error: `쪽지는 ${MAX_NOTE}자까지예요` }, 400);
  const doping = body.doping === true;

  const round = await activeRound(env);
  if (!round) return json({ error: "지금 열린 라운드가 없어요" }, 409);
  const t = await env.DB.prepare("SELECT * FROM quest2_targets WHERE id = ? AND round_id = ?").bind(targetId, round.id).first<TargetRow>();
  if (!t) return json({ error: "없는 목표예요" }, 404);
  const mine = new Set(me.chars ?? [me.id]);
  if (!mine.has(t.nickname)) return json({ error: "내 캐릭터가 아니에요" }, 403);

  const exists = await env.DB.prepare("SELECT 1 FROM quest2_claims WHERE target_id = ? AND status = 'pending'").bind(t.id).first();
  if (exists) return json({ error: "신청이 이미 있어요 · 오피서가 처리하면 다시 신청할 수 있어요" }, 409);

  const currentLevel = await levelOf(env, t.nickname);
  if (currentLevel === null) return json({ error: "레벨을 아직 안 적었어요 · '내 정보'에서 먼저 적어 주세요" }, 400);
  const toLevel = Math.min(currentLevel, t.end_level);
  const bands = await readBands(env);
  const gold = levelReward(t.paid_to_level, toLevel, bands);
  if (gold <= 0 && !doping) return json({ error: toLevel <= t.start_level ? "아직 레벨을 안 올렸어요" : "이미 다 받았어요" }, 400);

  const now = Date.now();
  const row = await env.DB.prepare(
    "INSERT INTO quest2_claims (target_id, user_id, from_level, to_level, gold, doping, note, status, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?) RETURNING *",
  )
    .bind(t.id, me.id, t.paid_to_level, toLevel, gold, doping ? 1 : 0, note, now)
    .first();
  if (!row) return json({ error: "신청하지 못했어요" }, 500);

  const goldText = gold ? ` · ${gold.toLocaleString("ko-KR")}골드` : "";
  await notifyOfficers(env, `${t.nickname}님의 2군 성장 퀘스트 보상 신청${goldText}${doping ? " · 도핑 지원" : ""}`, me.id);
  return json({ ok: true }, 201);
};
