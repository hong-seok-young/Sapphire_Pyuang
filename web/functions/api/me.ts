// GET /api/me -> 로그인한 사람 { id, role, mustChange }. 로그인 안 했으면 401
// 앱이 열릴 때마다 부르므로 여기서 로그인을 400일로 다시 늘린다 (로그아웃하기 전까지 로그인 유지)
import { NEED_LOGIN, currentUser, json, renewSession } from "../../server/auth";
import type { Env } from "../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const renewed = await renewSession(env, request);
  return json({ id: me.id, role: me.role, mustChange: me.must_change === 1 }, 200, renewed ? { "set-cookie": renewed } : {});
};
