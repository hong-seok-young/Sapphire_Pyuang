// GET /api/me -> 로그인한 사람 { id, role, mustChange }. 로그인 안 했으면 401
import { NEED_LOGIN, currentUser, json } from "../../server/auth";
import type { Env } from "../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  return json({ id: me.id, role: me.role, mustChange: me.must_change === 1 });
};
