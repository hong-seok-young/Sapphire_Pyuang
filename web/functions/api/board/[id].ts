// GET    /api/board/:id -> 글 하나 (본 사람으로 센다): 글, 사진과 파일 목록, 댓글, 좋아요
// PATCH  /api/board/:id { title?, body?, pinned? } -> 고치기 (제목, 내용은 쓴 사람만. 고정은 오피서 이상)
// DELETE /api/board/:id -> 지우기 (쓴 사람 또는 오피서 이상)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { BODY_MAX, TITLE_MAX, deletePostStmts, isStaff, loadPost } from "../../../server/board";

const postId = (params: Record<string, string | string[]>) => Number(params.id);

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = postId(params);
  const post = await loadPost(env, id);
  if (!post) return json({ error: "없는 글이에요" }, 404);
  await env.DB.prepare("INSERT INTO board_views (post_id, user_id, at) VALUES (?, ?, ?) ON CONFLICT (post_id, user_id) DO NOTHING")
    .bind(id, me.id, Date.now())
    .run();
  const [files, comments, likes, views, roles] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, type, size, image FROM board_files WHERE post_id = ? ORDER BY id").bind(id),
    env.DB.prepare("SELECT id, user_id AS user, parent_id AS parent, text, created_at AS at FROM board_comments WHERE post_id = ? ORDER BY id").bind(id),
    env.DB.prepare("SELECT user_id AS user FROM board_likes WHERE post_id = ?").bind(id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM board_views WHERE post_id = ?").bind(id),
    env.DB.prepare(
      "SELECT id, role FROM users WHERE id = ? OR id IN (SELECT user_id FROM board_comments WHERE post_id = ?)",
    ).bind(post.author, id),
  ]);
  const likers = (likes.results as { user: string }[]).map((r) => r.user);
  return json({
    post: { ...post, pinned: post.pinned === 1 },
    files: (files.results as { image: number }[]).map((f) => ({ ...f, image: f.image === 1 })),
    comments: comments.results,
    likes: likers.length,
    liked: likers.includes(me.id),
    views: (views.results[0] as { n: number } | undefined)?.n ?? 0,
    roles: Object.fromEntries((roles.results as { id: string; role: string }[]).map((r) => [r.id, r.role])),
  });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = postId(params);
  const post = await loadPost(env, id);
  if (!post) return json({ error: "없는 글이에요" }, 404);
  const b = await readJson<{ title: unknown; body: unknown; pinned: unknown }>(request);
  if (b.pinned !== undefined) {
    if (!isStaff(me.role) || typeof b.pinned !== "boolean") return FORBIDDEN();
    await env.DB.prepare("UPDATE board_posts SET pinned = ? WHERE id = ?").bind(b.pinned ? 1 : 0, id).run();
  }
  if (b.title !== undefined || b.body !== undefined) {
    if (post.author !== me.id) return FORBIDDEN();
    const title = typeof b.title === "string" ? b.title.trim() : post.title;
    const body = typeof b.body === "string" ? b.body.replace(/\r\n/g, "\n").trim() : post.body;
    if (!title || title.length > TITLE_MAX) return json({ error: `제목은 ${TITLE_MAX}자까지 적어 주세요` }, 400);
    if (body.length > BODY_MAX) return json({ error: `내용은 ${BODY_MAX}자까지예요` }, 400);
    await env.DB.prepare("UPDATE board_posts SET title = ?, body = ?, edited_at = ? WHERE id = ?").bind(title, body, Date.now(), id).run();
  }
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = postId(params);
  const post = await loadPost(env, id);
  if (!post) return json({ error: "없는 글이에요" }, 404);
  if (post.author !== me.id && !isStaff(me.role)) return FORBIDDEN();
  await env.DB.batch(deletePostStmts(env, id));
  return json({ ok: true });
};
