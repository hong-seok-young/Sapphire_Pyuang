// GET /api/market/:id/shot -> 위키에 없는 물건의 스샷 그림 (로그인한 길드원). 판 사람이 갤러리에서 고른 그림 (제작자 요청 2026-11-02)
import { NEED_LOGIN, blobBytes, currentUser, json, paramId } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  if (!Number.isInteger(id)) return json({ error: "없는 그림이에요" }, 404);
  const row = await env.DB.prepare("SELECT type, data FROM listing_shots WHERE listing_id = ?").bind(id).first<{ type: string; data: unknown }>();
  if (!row) return json({ error: "없는 그림이에요" }, 404);
  const bytes = blobBytes(row.data);
  // 스샷은 올린 뒤 바뀌지 않는다 (글을 지우면 같이 지운다)
  return new Response(bytes, { headers: { "content-type": row.type, "cache-control": "private, max-age=86400" } });
};
