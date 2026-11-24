// GET /api/diary/shots/:sid -> 증거 스샷 (보는 사람만, 다른 사람에게는 404)
import { NEED_LOGIN, blobBytes, currentUser } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { NOPE, canUseDiary } from "../../../../server/diary";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  const row = await env.DB.prepare("SELECT type, data, created_at FROM diary_shots WHERE id = ?").bind(Number(params.sid)).first<{ type: string; data: unknown }>();
  if (!row) return NOPE();
  return new Response(blobBytes(row.data), {
    headers: { "content-type": row.type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" },
  });
};
