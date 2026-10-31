// GET /api/users/:id/history -> 그 사람의 레벨·경험치 기록 (로그인한 길드원 누구나, 제작자 요청 2026-10-31:
// 랭킹에서 닉네임을 누르면 보이는 그래프). 경험치는 랭킹에서도 모두에게 보이므로 그대로 준다. 최근 300개를 오래된 것부터
import { NEED_LOGIN, currentUser, json, paramId } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = paramId(params);
  const [log, profile] = await env.DB.batch([
    env.DB.prepare("SELECT at, level, exp FROM (SELECT at, level, exp FROM level_log WHERE user_id = ? ORDER BY at DESC LIMIT 300) ORDER BY at").bind(id),
    env.DB.prepare("SELECT level, exp FROM profiles WHERE user_id = ?").bind(id),
  ]);
  if (!profile.results.length) return json({ error: "레벨을 정하지 않은 길드원이에요" }, 404);
  return json({ points: log.results, profile: profile.results[0] });
};
