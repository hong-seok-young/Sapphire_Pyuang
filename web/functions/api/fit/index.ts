// GET /api/fit -> { custom, routines, draft, workouts } : 헬스 루틴의 내 자료 모두 (개발중, server/fit.ts).
// 끝낸 운동은 최근 1500개 (세트 JSON 그대로, 그래프·최고 기록·지난번 값은 화면이 셈한다)
import { FORBIDDEN, NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canUseFit } from "../../../server/fit";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseFit(me)) return FORBIDDEN();
  const [custom, routines, draft, workouts] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, part, kind FROM fit_exercises WHERE user_id = ? ORDER BY id").bind(me.id),
    env.DB.prepare("SELECT id, name, items, updated_at FROM fit_routines WHERE user_id = ? ORDER BY sort, id").bind(me.id),
    env.DB.prepare("SELECT data, updated_at FROM fit_drafts WHERE user_id = ?").bind(me.id),
    env.DB.prepare("SELECT id, day, started_at, ended_at, title, volume, sets, data FROM fit_workouts WHERE user_id = ? ORDER BY started_at DESC LIMIT 1500").bind(me.id),
  ]);
  return json({
    custom: custom.results,
    routines: routines.results,
    draft: (draft.results[0] as { data: string; updated_at: number } | undefined) ?? null,
    workouts: workouts.results,
  });
};
