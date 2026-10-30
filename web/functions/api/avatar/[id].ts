// GET /api/avatar/:id -> 그 길드원의 캐릭터 그림 (PNG, 로그인한 길드원만).
// 화면은 ?v=올린때 를 붙여 부르므로 그림이 바뀌면 주소가 바뀐다. 그래서 오래 두고 써도 된다
import { NEED_LOGIN, blobBytes, currentUser, json, paramId } from "../../../server/auth";
import type { Env } from "../../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await env.DB.prepare("SELECT png FROM avatars WHERE user_id = ?").bind(paramId(params)).first<{ png: unknown }>();
  if (!row) return json({ error: "그림이 없어요" }, 404);
  return new Response(blobBytes(row.png), {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
};
