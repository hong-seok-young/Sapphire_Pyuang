// DELETE /api/board/comments/:cid -> 댓글 지우기 (쓴 사람 또는 오피서 이상). 댓글을 지우면 그 답글도 지운다
import { FORBIDDEN, NEED_LOGIN, currentUser, json } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { isStaff } from "../../../../server/board";

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const cid = Number(params.cid);
  const row = await env.DB.prepare("SELECT user_id FROM board_comments WHERE id = ?").bind(cid).first<{ user_id: string }>();
  if (!row) return json({ error: "없는 댓글이에요" }, 404);
  if (row.user_id !== me.id && !isStaff(me.role)) return FORBIDDEN();
  await env.DB.prepare("DELETE FROM board_comments WHERE id = ? OR parent_id = ?").bind(cid, cid).run();
  return json({ ok: true });
};
