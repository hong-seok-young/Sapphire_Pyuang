// GET    /api/board/files/:fid -> 사진이나 첨부 파일 (로그인한 길드원만). 사진이 아니면 내려받기로만 준다 (페이지로 열리지 않게)
// DELETE /api/board/files/:fid -> 지우기 (글 쓴 사람만)
import { FORBIDDEN, NEED_LOGIN, blobBytes, currentUser, json } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await env.DB.prepare("SELECT name, type, image, data FROM board_files WHERE id = ?")
    .bind(Number(params.fid))
    .first<{ name: string; type: string; image: number; data: unknown }>();
  if (!row) return json({ error: "없는 파일이에요" }, 404);
  const headers: Record<string, string> = {
    "cache-control": "private, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  };
  if (row.image === 1) {
    headers["content-type"] = row.type;
  } else {
    headers["content-type"] = "application/octet-stream";
    headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`;
  }
  return new Response(blobBytes(row.data), { headers });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await env.DB.prepare("SELECT p.author FROM board_files f JOIN board_posts p ON p.id = f.post_id WHERE f.id = ?")
    .bind(Number(params.fid))
    .first<{ author: string }>();
  if (!row) return json({ error: "없는 파일이에요" }, 404);
  if (row.author !== me.id) return FORBIDDEN();
  await env.DB.prepare("DELETE FROM board_files WHERE id = ?").bind(Number(params.fid)).run();
  return json({ ok: true });
};
