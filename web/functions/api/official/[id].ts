// GET /api/official/:id -> 컴투스 공식 글 하나 (로그인한 길드원 누구나): 게시판 '아이모 소식'에서 앱 안에서 읽는다 (제작자 요청 2026-11-01)
// html 은 scripts/fetch-official.mjs 가 문단, 굵게, 표, 목록, 그림, 링크만 남긴 것. 화면이 한 번 더 걸러서 그린다.
// 게시판 글처럼 본 사람으로 세고(views) 좋아요·댓글을 같이 준다 (제작자 2026-11-06 '아이모 소식에서도 조회수 댓글 등등, 일반 게시판이랑 똑같이')
import { NEED_LOGIN, currentUser, json, paramId } from "../../../server/auth";
import type { Env } from "../../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  if (!Number.isInteger(id)) return json({ error: "없는 글이에요" }, 404);
  const row = await env.DB.prepare(
    "SELECT id, kind, type, title, start_date AS start, end_date AS end, image, html, body FROM official_news WHERE id = ?",
  )
    .bind(id)
    .first();
  if (!row) return json({ error: "없는 글이에요" }, 404);
  const [, comments, likes, views, roles] = await env.DB.batch([
    env.DB.prepare("INSERT INTO official_views (post_id, user_id, at) VALUES (?, ?, ?) ON CONFLICT (post_id, user_id) DO NOTHING").bind(id, me.id, Date.now()),
    env.DB.prepare("SELECT id, user_id AS user, parent_id AS parent, text, created_at AS at FROM official_comments WHERE post_id = ? ORDER BY id").bind(id),
    env.DB.prepare("SELECT user_id AS user FROM official_likes WHERE post_id = ?").bind(id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM official_views WHERE post_id = ?").bind(id),
    env.DB.prepare("SELECT id, role FROM users WHERE id IN (SELECT user_id FROM official_comments WHERE post_id = ?)").bind(id),
  ]);
  const likers = (likes.results as { user: string }[]).map((r) => r.user);
  return json({
    ...row,
    comments: comments.results,
    likes: likers.length,
    liked: likers.includes(me.id),
    views: (views.results[0] as { n: number } | undefined)?.n ?? 0,
    roles: Object.fromEntries((roles.results as { id: string; role: string }[]).map((r) => [r.id, r.role])),
  });
};
