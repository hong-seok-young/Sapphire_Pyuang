// POST /api/users/:id/reset { password? } -> 비밀번호를 처음 비밀번호(정한 것이나 임시)로 (자기보다 낮은 역할만).
// 그 사람의 로그인은 모두 끝내고, 다음 로그인 때 비밀번호를 바꾸게 한다
import {
  FORBIDDEN, NEED_LOGIN, canManage, currentUser, firstPassword, json, paramId, passwordFields, readJson,
} from "../../../../server/auth";
import type { Env, Role } from "../../../../server/auth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = paramId(params);
  const user = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(id).first<{ id: string; role: Role }>();
  if (!user) return json({ error: "없는 아이디예요" }, 404);
  if (user.id === me.id || !canManage(me.role, user.role)) return FORBIDDEN();

  const body = await readJson<{ password: string }>(request);
  const temp = firstPassword(body.password);
  if (temp === null) return json({ error: "처음 비밀번호는 6자 이상으로 해 주세요" }, 400);
  const pw = await passwordFields(temp);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, must_change = 1 WHERE id = ?")
      .bind(pw.pw_hash, pw.pw_salt, pw.pw_iter, user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
  ]);
  return json({ id: user.id, tempPassword: temp });
};
