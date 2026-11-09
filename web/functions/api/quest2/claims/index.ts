// POST /api/quest2/claims { targetId, doping?, note? } -> 보상받기 신청 (목표 캐릭터 본인만, 신청은 그 캐릭터 하나에 한 번).
//   완주(지금 레벨이 목표 레벨 이상)해야 보상 신청이 되고, 공포티모처럼 이미 목표 레벨인 줄은 doping 만 신청할 수 있다. 오피서에게 알림
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_NOTE, activeRound, canUseQuest2, completionCount, levelOf, notifyOfficers, text } from "../../../../server/quest2";
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

  const exists = await env.DB.prepare("SELECT 1 FROM quest2_claims WHERE target_id = ? AND status != 'rejected'").bind(t.id).first();
  if (exists) return json({ error: "신청이 이미 있어요 (거절된 신청은 다시 할 수 있어요)" }, 409);

  const doneAlready = t.start_level === t.end_level;
  let rank: number | null = null;
  let reward: string | null = null;
  if (!doneAlready) {
    const currentLevel = await levelOf(env, t.nickname);
    if (currentLevel === null) return json({ error: "레벨을 아직 안 적었어요 · '내 정보'에서 먼저 적어 주세요" }, 400);
    if (currentLevel < t.end_level) return json({ error: `아직 목표(Lv.${t.end_level})에 닿지 않았어요 · 지금 Lv.${currentLevel}` }, 400);
    rank = (await completionCount(env, round.id)) + 1;
    reward = rank <= round.bonus_slots ? round.bonus_reward : round.standard_reward;
  } else if (!doping) {
    return json({ error: "이미 목표 레벨이에요 · 도핑 지원이 필요하면 체크해 주세요" }, 400);
  }

  const now = Date.now();
  const row = await env.DB.prepare(
    "INSERT INTO quest2_claims (target_id, user_id, rank, reward, doping, note, status, requested_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?) RETURNING *",
  )
    .bind(t.id, me.id, rank, reward, doping ? 1 : 0, note, now)
    .first();
  if (!row) return json({ error: "신청하지 못했어요" }, 500);

  const rankText = rank ? (rank <= round.bonus_slots ? ` · 선착 ${rank}번째 (보너스 보상!)` : ` · 완주 ${rank}번째`) : "";
  await notifyOfficers(env, `${t.nickname}님의 2군 성장 퀘스트 보상 신청${rankText}${doping ? " · 도핑 지원" : ""}`, me.id);
  return json({ ok: true }, 201);
};
