// DELETE /api/users/:id/avatar -> 다른 사람의 캐릭터 그림 내리기 (오피서 이상. 캐릭터가 아닌 그림이 올라왔을 때)
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, paramId } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (RANK[me.role] < 1) return FORBIDDEN();
  const res = await env.DB.prepare("DELETE FROM avatars WHERE user_id = ?").bind(paramId(params)).run();
  if (res.meta.changes === 0) return json({ error: "그림이 없어요" }, 404);
  return json({ ok: true });
};
