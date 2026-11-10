// DELETE /api/fit/exercises/:id -> 내 종목 지우기. 그 종목으로 한 운동 기록은 이름째로 남는다 (server/fit.ts)
import { FORBIDDEN, NEED_LOGIN, currentUser, json } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { canUseFit } from "../../../../server/fit";

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseFit(me)) return FORBIDDEN();
  const r = await env.DB.prepare("DELETE FROM fit_exercises WHERE id = ? AND user_id = ?").bind(Number(params.id), me.id).run();
  if (!r.meta.changes) return json({ error: "없는 종목이에요" }, 404);
  return json({ ok: true });
};
