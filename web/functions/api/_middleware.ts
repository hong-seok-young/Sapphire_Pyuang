// 사용 기록 (server/activity.ts): API 로 한 일을 앱개발자만 보는 '사용 기록'에 남긴다.
// 화면 보기는 /api/activity 가 따로 받고, GET 중에는 /api/me (앱을 열 때)만 접속으로 센다.
// 기록이 안 돼도 하던 일은 그대로 끝난다.
import { currentUser } from "../../server/auth";
import type { Env } from "../../server/auth";
import { detailOf, record, subjectOf, whereOf } from "../../server/activity";

/** 본문이 JSON 이 아닌 곳: 캐릭터 사진, AI 지우기(그림 파일)는 크기만 적는다 */
const BINARY = /^\/api\/(avatar(\/cutout)?|board\/\d+\/files)$/;

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const path = new URL(request.url).pathname;
  const method = request.method;
  const opening = method === "GET" && path === "/api/me";
  if ((method === "GET" && !opening) || method === "HEAD" || method === "OPTIONS" || path === "/api/activity" || path.startsWith("/api/alerts")) return context.next();

  let me: { id: string } | null = null;
  let body: unknown = null;
  let subject: string | null = null;
  try {
    // 로그아웃, 글 지우기는 끝난 뒤에는 누구인지, 무슨 글인지 모르므로 먼저 본다
    me = await currentUser(env, request);
    if (!opening && BINARY.test(path)) body = { size: `${Math.round(Number(request.headers.get("content-length") ?? 0) / 1024)}KB` };
    else if (!opening) body = await request.clone().json().catch(() => null);
    if (!opening) subject = await subjectOf(env, path);
  } catch {
    // 기록 준비가 안 돼도 하던 일은 한다
  }
  const res = await context.next();
  // 로그인은 틀린 것도 남긴다 (누가 몇 번 틀렸는지). 다른 실패는 남기지 않는다
  if (!res.ok && path !== "/api/login") return res;
  try {
    const where = whereOf(request);
    if (opening) {
      if (me) await record(env, me.id, "visit", "open", null, where);
    } else if (path === "/api/login") {
      // 로그인 본문에서는 아이디만 본다 (비밀번호는 남기지 않는다)
      const id = (body as { id?: unknown } | null)?.id;
      const detail = res.ok ? null : JSON.stringify({ failed: res.status });
      if (typeof id === "string" && id) await record(env, id.slice(0, 40), "act", "POST /api/login", detail, where);
    } else if (me) {
      await record(env, me.id, "act", `${method} ${decodeURIComponent(path)}`, detailOf(body, subject), where);
    }
  } catch {
    // 기록 실패는 무시한다
  }
  return res;
};
