// PUT /api/board/:id/like { on } -> 좋아요 누르기 / 취소 { likes, liked }
import { NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { loadPost } from "../../../../server/board";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(params.id);
  if (!(await loadPost(env, id))) return json({ error: "없는 글이에요" }, 404);
  const { on } = await readJson<{ on: unknown }>(request);
  if (typeof on !== "boolean") return json({ error: "on 은 true/false 예요" }, 400);
  await (on
    ? env.DB.prepare("INSERT INTO board_likes (post_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(id, me.id)
    : env.DB.prepare("DELETE FROM board_likes WHERE post_id = ? AND user_id = ?").bind(id, me.id)
  ).run();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM board_likes WHERE post_id = ?").bind(id).first<{ n: number }>();
  return json({ likes: n?.n ?? 0, liked: on });
};
