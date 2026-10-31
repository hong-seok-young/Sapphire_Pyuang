// DELETE /api/market/:id/talk/:talkId -> 토론방 글 지우기 (쓴 사람, 또는 오피서 이상)
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json } from "../../../../../server/auth";
import type { Env } from "../../../../../server/auth";

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const talkId = Number(params.talkId);
  const row = Number.isInteger(talkId)
    ? await env.DB.prepare("SELECT user_id FROM listing_talk WHERE id = ?").bind(talkId).first<{ user_id: string }>()
    : null;
  if (!row) return json({ error: "없는 글이에요" }, 404);
  if (row.user_id !== me.id && RANK[me.role] < 1) return FORBIDDEN();
  await env.DB.prepare("DELETE FROM listing_talk WHERE id = ?").bind(talkId).run();
  return json({ ok: true });
};
