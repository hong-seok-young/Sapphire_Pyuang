// DELETE /api/fit/workouts/:id -> 내 운동 기록 하나 지우기 (사람이 직접 지우는 것만, 기록은 저절로 지우지 않는다). server/fit.ts
import { FORBIDDEN, NEED_LOGIN, currentUser, json } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { canUseFit } from "../../../../server/fit";

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseFit(me)) return FORBIDDEN();
  const r = await env.DB.prepare("DELETE FROM fit_workouts WHERE id = ? AND user_id = ?").bind(Number(params.id), me.id).run();
  if (!r.meta.changes) return json({ error: "없는 기록이에요" }, 404);
  return json({ ok: true });
};
