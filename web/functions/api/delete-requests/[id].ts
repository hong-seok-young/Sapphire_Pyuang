// POST /api/delete-requests/:id { action: "approve" | "reject" } -> 계정 삭제 요청 승낙(그 계정을 지운다) / 거절 (오피서 이상, 그 사람을 다룰 수 있을 때만)
// 지우는 것은 길드원 관리의 '계정 삭제'와 같다 (server/accountDelete.ts). 길드마스터의 요청은 앱개발자만 승낙한다 (canManageUser)
import { FORBIDDEN, NEED_LOGIN, RANK, canManageUser, currentUser, json, paramId, readJson, samePerson } from "../../../server/auth";
import type { Env, Role } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import { deleteAccountData } from "../../../server/accountDelete";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (RANK[me.role] < 1) return FORBIDDEN();
  const id = paramId(params);
  const { action } = await readJson<{ action: unknown }>(request);
  const req = await env.DB.prepare("SELECT user_id FROM delete_requests WHERE user_id = ?").bind(id).first();
  if (!req) return json({ error: "이미 처리한 요청이에요" }, 404);
  const user = await env.DB.prepare("SELECT id, role, main_id FROM users WHERE id = ?").bind(id).first<{ id: string; role: Role; main_id: string | null }>();
  if (!user) {
    await env.DB.prepare("DELETE FROM delete_requests WHERE user_id = ?").bind(id).run();
    return json({ error: "이미 없는 계정이에요 (요청은 지웠어요)" }, 404);
  }
  if (samePerson(me, user) || !(await canManageUser(env, me.role, user.id, user.role))) return FORBIDDEN();
  if (action === "reject") {
    await env.DB.prepare("DELETE FROM delete_requests WHERE user_id = ?").bind(id).run();
    await notify(env, [user.id], "account", "계정 삭제 요청이 거절됐어요", "#/me", me.id);
    return json({ ok: true });
  }
  if (action !== "approve") return json({ error: "승낙이나 거절을 골라 주세요" }, 400);
  await deleteAccountData(env, user);
  return json({ ok: true });
};
