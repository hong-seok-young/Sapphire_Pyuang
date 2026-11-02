// GET /api/ranking -> 길드 레벨 랭킹 (로그인한 길드원 누구나).
// 레벨이 높은 순, 같은 레벨이면 경험치 %가 높은 순 (안 적은 사람은 아래), 그것도 같으면 그 레벨에 먼저 오른 사람이 위.
// 경험치 숫자는 본인 줄에만 넣는다 (각자만 아는 값). avatar 는 캐릭터 그림을 올린 때 (없으면 null)
import { NEED_LOGIN, currentUser, json } from "../../server/auth";
import type { Env, Guild, Job, Role } from "../../server/auth";
import { weekStart } from "../../server/week";
import { startPoints } from "../../server/growth";

/**
 * 이번 주(목요일 오전 10시부터, 제작자 요청)에 경험치만 오른 만큼 (% x 1000, 제작자 요청: 레벨업 ▲ 처럼 '+2%').
 * 주간 성장 랭킹과 같은 계산: 주가 시작할 때의 기록(시작 전 마지막, 없으면 이번 주 첫 기록)과 지금을 비교한다
 * (2026-11-02 제작자: 마지막 한 번만 비교해서 이번 주 +7.761% 인데 +0.41% 로 떴다). '오타 수정'은 새 기록 대신 마지막 기록을 고치므로
 * 성장으로 잡히지 않는다. 처음 적은 경험치(시작 때 경험치가 없었음)는 오른 게 아니다. 레벨이 바뀌었으면 ▲ 가 맡는다
 */
function expUp(from: { level: number; exp: number | null } | undefined, now: { level: number; exp: number | null }): number {
  return from && from.level === now.level && from.exp !== null && now.exp !== null && now.exp > from.exp ? now.exp - from.exp : 0;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const base = await startPoints(env, weekStart());
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
      expUp: expUp(base.get(r.id), r),
    })),
  );
};
