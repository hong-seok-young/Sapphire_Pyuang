// GET /api/official/:id -> 컴투스 공식 글 하나 (로그인한 길드원 누구나): 게시판 '아이모 소식'에서 앱 안에서 읽는다 (제작자 요청 2026-11-01)
// html 은 scripts/fetch-official.mjs 가 문단, 굵게, 표, 목록, 그림, 링크만 남긴 것. 화면이 한 번 더 걸러서 그린다
import { NEED_LOGIN, currentUser, json, paramId } from "../../../server/auth";
import type { Env } from "../../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  if (!Number.isInteger(id)) return json({ error: "없는 글이에요" }, 404);
  const row = await env.DB.prepare(
    "SELECT id, kind, type, title, start_date AS start, end_date AS end, image, html, body FROM official_news WHERE id = ?",
  )
    .bind(id)
    .first();
  if (!row) return json({ error: "없는 글이에요" }, 404);
  return json(row);
};
