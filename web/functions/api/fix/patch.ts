// GET /api/fix/patch -> 패치 내역에 저절로 더해진 줄 (개선 접수에서 '고침', 로그인한 길드원 모두). 화면 #/patch 가 그 판에 붙인다
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const { results } = await env.DB.prepare("SELECT version, text, created_at FROM patch_extra ORDER BY id LIMIT 500").all();
  return json({ lines: results }, 200, { "cache-control": "private, max-age=60" });
};
