// GET /api/ranking -> 길드 레벨 랭킹 (로그인한 길드원 누구나).
// 레벨이 높은 순, 같은 레벨이면 경험치 %가 높은 순 (안 적은 사람은 아래), 그것도 같으면 그 레벨에 먼저 오른 사람이 위.
// 경험치 숫자는 본인 줄에만 넣는다 (각자만 아는 값). avatar 는 캐릭터 그림을 올린 때 (없으면 null)
import { NEED_LOGIN, currentUser, json } from "../../server/auth";
import type { Env, Guild, Job, Role } from "../../server/auth";

const RECENT_MS = 7 * 86_400_000;

/**
 * 최근 7일 안에 경험치만 오른 만큼 (% x 1000, 제작자 요청: 레벨업 ▲ 처럼 '+2%'). 성장 기록(level_log)의 마지막 기록과
 * 그 앞의 다른 값 기록을 비교한다. '오타 수정'은 새 기록 대신 마지막 기록을 고치므로 여기에 잡히지 않는다. 레벨이 바뀌었으면 ▲ 가 맡는다
 */
async function expUps(env: Env): Promise<Map<string, number>> {
  const { results } = await env.DB.prepare(
    "SELECT user_id, at, level, exp FROM (SELECT user_id, at, level, exp, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY at DESC) AS rn FROM level_log) " +
      "WHERE rn <= 8 ORDER BY user_id, at DESC",
  ).all<{ user_id: string; at: number; level: number; exp: number | null }>();
  const ups = new Map<string, number>();
  const now = Date.now();
  let i = 0;
  while (i < results.length) {
    const user = results[i].user_id;
    const rows: typeof results = [];
    while (i < results.length && results[i].user_id === user) rows.push(results[i++]);
    const last = rows[0];
    if (now - last.at > RECENT_MS) continue;
    const before = rows.find((r) => r.level !== last.level || r.exp !== last.exp);
    // 앞 기록에 경험치가 없었으면(처음 적은 것) 오른 게 아니다
    if (before && before.level === last.level && before.exp !== null && last.exp !== null && last.exp > before.exp) {
      ups.set(user, last.exp - before.exp);
    }
  }
  return ups;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const ups = await expUps(env);
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
      expUp: ups.get(r.id) ?? 0,
    })),
  );
};
