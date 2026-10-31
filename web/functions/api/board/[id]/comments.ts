// POST /api/board/:id/comments { text, parent? } -> 댓글 (parent 를 주면 그 댓글의 답글, 한 단계). 500자, 1분에 10개
// 글쓴이에게, 답글이면 원래 댓글 쓴 사람에게도 알림
import { NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { COMMENT_MAX, loadPost } from "../../../../server/board";
import { notify } from "../../../../server/alerts";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(params.id);
  const post = await loadPost(env, id);
  if (!post) return json({ error: "없는 글이에요" }, 404);
  const b = await readJson<{ text: unknown; parent: unknown }>(request);
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text || text.length > COMMENT_MAX) return json({ error: `댓글은 ${COMMENT_MAX}자까지 적어 주세요` }, 400);
  let parent: { id: number; user_id: string } | null = null;
  if (b.parent !== undefined && b.parent !== null) {
    parent = await env.DB.prepare("SELECT id, user_id FROM board_comments WHERE id = ? AND post_id = ? AND parent_id IS NULL")
      .bind(Number(b.parent), id)
      .first<{ id: number; user_id: string }>();
    if (!parent) return json({ error: "답글을 달 댓글이 없어요" }, 400);
  }
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM board_comments WHERE user_id = ? AND created_at > ?")
    .bind(me.id, now - 60_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 10) return json({ error: "잠깐 뒤에 다시 써 주세요" }, 429);
  const row = await env.DB.prepare("INSERT INTO board_comments (post_id, user_id, parent_id, text, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(id, me.id, parent?.id ?? null, text, now)
    .first<{ id: number }>();
  const link = `#/board/${id}`;
  const short = text.length > 30 ? text.slice(0, 30) + "…" : text;
  if (post.author !== me.id) await notify(env, [post.author], "board", `${me.id}: “${short}” (${post.title})`, link, me.id);
  if (parent && parent.user_id !== me.id && parent.user_id !== post.author) {
    await notify(env, [parent.user_id], "board", `${me.id} 님의 답글: “${short}”`, link, me.id);
  }
  return json({ id: row?.id, user: me.id, parent: parent?.id ?? null, text, at: now }, 201);
};
