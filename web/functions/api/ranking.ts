// GET /api/ranking -> 길드 레벨 랭킹 (로그인한 길드원 누구나).
// 레벨이 높은 순, 같은 레벨이면 경험치 %가 높은 순 (안 적은 사람은 아래), 그것도 같으면 그 레벨에 먼저 오른 사람이 위.
// 경험치 숫자는 본인 줄에만 넣는다 (각자만 아는 값). avatar 는 캐릭터 그림을 올린 때 (없으면 null)
import { NEED_LOGIN, currentUser, json } from "../../server/auth";
import type { Env, Guild, Job, Role } from "../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const { results } = await env.DB.prepare(
    "SELECT u.id AS id, u.role AS role, p.job AS job, p.level AS level, p.prev_level AS prev_level, p.level_at AS level_at, " +
      "p.exp AS exp, p.guild AS guild, u.high_spec AS high_spec, a.updated_at AS avatar FROM profiles p JOIN users u ON u.id = p.user_id AND u.id NOT IN ('테스트1', '테스트2') " +
      "LEFT JOIN avatars a ON a.user_id = p.user_id ORDER BY p.level DESC, p.exp DESC, p.level_at ASC, u.id ASC",
  ).all<{
    id: string; role: Role; job: Job; level: number; prev_level: number | null; level_at: number; exp: number | null;
    guild: Guild | null; avatar: number | null; high_spec: number;
  }>();
  return json(
    results.map((r) => ({
      id: r.id, role: r.role, job: r.job, level: r.level, prevLevel: r.prev_level, levelAt: r.level_at, guild: r.guild, avatar: r.avatar,
      highSpec: r.high_spec === 1,
      exp: r.exp, // 모두에게 보인다 (제작자 요청: 성장 순위 보상 이벤트를 확인하려고)
    })),
  );
};
