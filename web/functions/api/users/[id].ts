// DELETE /api/users/:id         -> 계정 지우기 (자기보다 낮은 역할만). 부캐가 있는 본캐를 지우면 가장 먼저 묶은 부캐가 본캐가 되고 비밀번호를 이어받는다
// PATCH  /api/users/:id { role } -> 역할 바꾸기 (오피서 이상: 오피서 임명/해제 등. 오피서도 길드마스터와 같다)
import { FORBIDDEN, NEED_LOGIN, canManage, canManageUser, currentUser, isRole, json, paramId, readJson, samePerson } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import { deleteAccountData } from "../../../server/accountDelete";
import type { Env, Role } from "../../../server/auth";

async function target(env: Env, params: Record<string, string | string[]>) {
  const id = paramId(params);
  return env.DB.prepare("SELECT id, role, main_id FROM users WHERE id = ?").bind(id).first<{ id: string; role: Role; main_id: string | null }>();
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const user = await target(env, params);
  if (!user) return json({ error: "없는 아이디예요" }, 404);
  if (samePerson(me, user) || !(await canManageUser(env, me.role, user.id, user.role))) return FORBIDDEN();
  await deleteAccountData(env, user);
  return json({ ok: true });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const user = await target(env, params);
  if (!user) return json({ error: "없는 아이디예요" }, 404);
  const body = await readJson<{ role: string }>(request);
  const role = body.role;
  if (!isRole(role) || samePerson(me, user) || !(await canManageUser(env, me.role, user.id, user.role)) || !canManage(me.role, role)) {
    return FORBIDDEN();
  }
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, user.id).run();
  const name = { master: "길드마스터", officer: "오피서", member: "길드원", developer: "앱개발자" }[role];
  await notify(env, [user.id], "account", `역할이 ${name}(으)로 바뀌었어요`, "#/me", me.id);
  return json({ id: user.id, role });
};
