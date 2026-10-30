// POST /api/logout -> 이 기기의 로그인 끝내기
import { clearCookie, deleteSession, json } from "../../server/auth";
import type { Env } from "../../server/auth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  await deleteSession(env, request);
  return json({ ok: true }, 200, { "set-cookie": clearCookie });
};
