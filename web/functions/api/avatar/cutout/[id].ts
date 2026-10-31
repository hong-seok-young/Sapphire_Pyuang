// GET /api/avatar/cutout/:id -> AI 지우기 중인 그림 (Cloudflare 이미지 변환이 읽는 주소, cutout/index.ts).
// 변환은 로그인 쿠키 없이 읽으므로 로그인을 묻지 않는다. 대신 주소는 맞힐 수 없는 긴 값이고 2분 안에만, 끝나면 바로 지운다
import { blobBytes, json, paramId } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = paramId(params);
  if (!/^[0-9a-f-]{72}$/.test(id)) return json({ error: "없어요" }, 404);
  const row = await env.DB.prepare("SELECT img, type FROM cutout_tmp WHERE id = ? AND created_at > ?")
    .bind(id, Date.now() - 2 * 60_000)
    .first<{ img: unknown; type: string }>();
  if (!row) return json({ error: "없어요" }, 404);
  return new Response(blobBytes(row.img), { headers: { "content-type": row.type, "cache-control": "no-store" } });
};
