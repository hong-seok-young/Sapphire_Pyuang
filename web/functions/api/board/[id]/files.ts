// POST /api/board/:id/files (본문: 파일, 머리글 x-file-name: 이름(encodeURIComponent)) -> 사진이나 첨부 파일 하나 올리기 (쓴 사람만)
// 사진(JPEG, PNG, WebP, GIF)은 글에 그림으로 보이고, 나머지는 내려받기 파일. 글 하나에 10개, 하나 1.9MB 까지 (사진은 화면이 줄여 보낸다)
import { FORBIDDEN, NEED_LOGIN, currentUser, json } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { FILES_MAX, FILE_MAX_BYTES, IMAGE_TYPES, cleanName, loadPost } from "../../../../server/board";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(params.id);
  const post = await loadPost(env, id);
  if (!post) return json({ error: "없는 글이에요" }, 404);
  if (post.author !== me.id) return FORBIDDEN();
  if (Number(request.headers.get("content-length") ?? 0) > FILE_MAX_BYTES) return json({ error: "파일은 1.9MB 까지예요" }, 413);
  const data = new Uint8Array(await request.arrayBuffer());
  if (!data.length) return json({ error: "빈 파일이에요" }, 400);
  if (data.length > FILE_MAX_BYTES) return json({ error: "파일은 1.9MB 까지예요" }, 413);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM board_files WHERE post_id = ?").bind(id).first<{ n: number }>();
  if ((count?.n ?? 0) >= FILES_MAX) return json({ error: `사진과 파일은 글 하나에 ${FILES_MAX}개까지예요` }, 400);
  let name = "file";
  try {
    name = cleanName(decodeURIComponent(request.headers.get("x-file-name") ?? "file"));
  } catch {
    // 이름이 깨졌으면 file
  }
  const type = (request.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase().slice(0, 100);
  const image = IMAGE_TYPES.includes(type) ? 1 : 0;
  const row = await env.DB.prepare(
    "INSERT INTO board_files (post_id, name, type, size, image, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(id, name, type, data.length, image, data, Date.now())
    .first<{ id: number }>();
  return json({ id: row?.id, name, type, size: data.length, image: image === 1 }, 201);
};
