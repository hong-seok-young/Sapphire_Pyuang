// POST /api/official/:id/comments { text, parent? } -> 아이모 소식 글의 댓글 (게시판 댓글과 같게: parent 를 주면 답글 한 단계, 500자, 1분에 10개).
// 공식 글은 쓴 길드원이 없어서 답글일 때만 원래 댓글 쓴 사람에게 알림 (제작자 2026-11-06 '아이모 소식에서도 조회수 댓글 등등')
import { NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { COMMENT_MAX } from "../../../../server/board";
import { notify } from "../../../../server/alerts";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(params.id);
  const post = Number.isInteger(id) ? await env.DB.prepare("SELECT title FROM official_news WHERE id = ?").bind(id).first<{ title: string }>() : null;
  if (!post) return json({ error: "없는 글이에요" }, 404);
  const b = await readJson<{ text: unknown; parent: unknown }>(request);
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text || text.length > COMMENT_MAX) return json({ error: `댓글은 ${COMMENT_MAX}자까지 적어 주세요` }, 400);
  let parent: { id: number; user_id: string } | null = null;
  if (b.parent !== undefined && b.parent !== null) {
    parent = await env.DB.prepare("SELECT id, user_id FROM official_comments WHERE id = ? AND post_id = ? AND parent_id IS NULL")
      .bind(Number(b.parent), id)
      .first<{ id: number; user_id: string }>();
    if (!parent) return json({ error: "답글을 달 댓글이 없어요" }, 400);
  }
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM official_comments WHERE user_id = ? AND created_at > ?")
    .bind(me.id, now - 60_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 10) return json({ error: "잠깐 뒤에 다시 써 주세요" }, 429);
  const row = await env.DB.prepare("INSERT INTO official_comments (post_id, user_id, parent_id, text, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(id, me.id, parent?.id ?? null, text, now)
    .first<{ id: number }>();
  const short = text.length > 30 ? text.slice(0, 30) + "…" : text;
  if (parent && parent.user_id !== me.id) await notify(env, [parent.user_id], "board", `${me.id} 님의 답글: “${short}” (${post.title})`, `#/official/${id}`, me.id);
  return json({ id: row?.id, user: me.id, parent: parent?.id ?? null, text, at: now }, 201);
};
