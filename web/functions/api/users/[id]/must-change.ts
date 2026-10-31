// POST /api/users/:id/must-change -> 그 사람이 다음에 들어올 때 비밀번호 바꾸기 화면을 한 번 보게 한다 (자기보다 낮은 역할만).
// 비밀번호 초기화와 달리 지금 비밀번호와 로그인은 그대로 둔다. 본인이 비밀번호를 바꾸고 싶다고 할 때 쓴다 (제작자 요청)
import { FORBIDDEN, NEED_LOGIN, canManage, currentUser, json, paramId } from "../../../../server/auth";
import type { Env, Role } from "../../../../server/auth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = paramId(params);
  const user = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(id).first<{ id: string; role: Role }>();
  if (!user) return json({ error: "없는 아이디예요" }, 404);
  if (user.id === me.id || !canManage(me.role, user.role)) return FORBIDDEN();
  await env.DB.prepare("UPDATE users SET must_change = 1 WHERE id = ?").bind(user.id).run();
  return json({ id: user.id, mustChange: true });
};
