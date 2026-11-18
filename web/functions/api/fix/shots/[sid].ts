// GET /api/fix/shots/:sid -> 접수 스샷 (운영진이나 쓴 사람)
import { NEED_LOGIN, blobBytes, currentUser, json } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { canSeeFix, ownsFix } from "../../../../server/fix";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await env.DB.prepare("SELECT s.type, s.data, r.user_id FROM fix_shots s JOIN fix_reports r ON r.id = s.report_id WHERE s.id = ?")
    .bind(Number(params.sid))
    .first<{ type: string; data: unknown; user_id: string }>();
  if (!row || !(canSeeFix(me) || ownsFix(me, row.user_id))) return json({ error: "없는 그림이에요" }, 404);
  return new Response(blobBytes(row.data), {
    headers: { "content-type": row.type, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
  });
};
