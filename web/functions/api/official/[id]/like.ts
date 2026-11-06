// PUT /api/official/:id/like { on } -> 아이모 소식 글 좋아요 누르기 / 취소 { likes, liked } (게시판 좋아요와 같다)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(params.id);
  if (!Number.isInteger(id) || !(await env.DB.prepare("SELECT 1 AS ok FROM official_news WHERE id = ?").bind(id).first())) return json({ error: "없는 글이에요" }, 404);
  const { on } = await readJson<{ on: unknown }>(request);
  if (typeof on !== "boolean") return json({ error: "on 은 true/false 예요" }, 400);
  await (on
    ? env.DB.prepare("INSERT INTO official_likes (post_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(id, me.id)
    : env.DB.prepare("DELETE FROM official_likes WHERE post_id = ? AND user_id = ?").bind(id, me.id)
  ).run();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM official_likes WHERE post_id = ?").bind(id).first<{ n: number }>();
  return json({ likes: n?.n ?? 0, liked: on });
};
