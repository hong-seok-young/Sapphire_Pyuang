// GET /api/ranking -> 길드 레벨 랭킹 (로그인한 길드원 누구나). 레벨이 높은 순, 같으면 먼저 오른 사람이 위
import { NEED_LOGIN, currentUser, json } from "../../server/auth";
import type { Env, Job, Role } from "../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const { results } = await env.DB.prepare(
    "SELECT u.id AS id, u.role AS role, p.job AS job, p.level AS level, p.prev_level AS prev_level, p.level_at AS level_at " +
      "FROM profiles p JOIN users u ON u.id = p.user_id ORDER BY p.level DESC, p.level_at ASC, u.id ASC",
  ).all<{ id: string; role: Role; job: Job; level: number; prev_level: number | null; level_at: number }>();
  return json(
    results.map((r) => ({ id: r.id, role: r.role, job: r.job, level: r.level, prevLevel: r.prev_level, levelAt: r.level_at })),
  );
};
