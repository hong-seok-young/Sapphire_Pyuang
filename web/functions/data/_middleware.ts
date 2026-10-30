// /data/* (위키 자료 JSON) 는 로그인한 길드원에게만 준다.
// 앱 화면(index.html, 스크립트)은 그대로 열리고, 로그인 전에는 로그인 화면만 보인다.
// 안드로이드 앱의 보스 타이머(WikiTimers.kt)도 위키 로그인 쿠키를 보내서 받는다.
import { NEED_LOGIN, currentUser } from "../../server/auth";
import type { Env } from "../../server/auth";

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "private, no-cache"); // 공용 캐시에 남기지 않고, 매번 바뀌었는지 확인
  return out;
};
