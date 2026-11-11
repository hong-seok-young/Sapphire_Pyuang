// 아이모 사기꾼 명단 (제작자 2026-11-11): GET /api/scam -> 명단 (로그인한 길드원, server/scam.ts)
import { NEED_LOGIN, currentUser, json } from "../../server/auth";
import type { Env } from "../../server/auth";
import { readScam } from "../../server/scam";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  return json({ list: await readScam(env) }, 200, { "cache-control": "no-store" });
};
