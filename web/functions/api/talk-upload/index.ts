// GET  /api/talk-upload -> 최근 올린 것 20개 (앱개발자·길드마스터)
// POST /api/talk-upload (본문: gzip 한 카톡 내보내기 글, 머리글 x-file-name·x-title·x-first·x-last·x-lines) -> 올리기. 조각으로 두면 GitHub Actions 가 자료 저장소에 더한다
import { FORBIDDEN, NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { PART, TALK_MAX_GZ, canUploadTalk } from "../../../server/talkUpload";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUploadTalk(me)) return FORBIDDEN();
  const { results } = await env.DB.prepare(
    "SELECT id, user_id, name, title, size, first_day, last_day, lines, status, note, created_at, done_at FROM talk_uploads ORDER BY id DESC LIMIT 20",
  ).all();
  return json({ uploads: results });
};

const head = (req: Request, k: string, max: number) => {
  const v = req.headers.get(k) ?? "";
  try {
    return decodeURIComponent(v).slice(0, max);
  } catch {
    return v.slice(0, max);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUploadTalk(me)) return FORBIDDEN();
  if (Number(request.headers.get("content-length") ?? 0) > TALK_MAX_GZ) return json({ error: "파일이 너무 커요" }, 413);
  const data = new Uint8Array(await request.arrayBuffer());
  if (data.length < 20 || data[0] !== 0x1f || data[1] !== 0x8b) return json({ error: "글을 읽지 못했어요" }, 400);
  if (data.length > TALK_MAX_GZ) return json({ error: "파일이 너무 커요" }, 413);
  const day = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(head(request, k, 10)) ? head(request, k, 10) : null);
  const row = await env.DB.prepare(
    "INSERT INTO talk_uploads (user_id, name, title, size, first_day, last_day, lines, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'wait', ?) RETURNING id",
  )
    .bind(me.id, head(request, "x-file-name", 120) || null, head(request, "x-title", 80) || null, Number(head(request, "x-size", 12)) || data.length, day("x-first"), day("x-last"), Number(head(request, "x-lines", 9)) || null, Date.now())
    .first<{ id: number }>();
  const id = row?.id ?? 0;
  const parts = [];
  for (let n = 0, at = 0; at < data.length; n++, at += PART)
    parts.push(env.DB.prepare("INSERT INTO talk_parts (upload_id, n, data) VALUES (?, ?, ?)").bind(id, n, data.subarray(at, at + PART)));
  await env.DB.batch(parts);
  return json({ id }, 201);
};
