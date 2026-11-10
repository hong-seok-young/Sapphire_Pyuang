// 사용 기록 (server/activity.ts): API 로 한 일을 앱개발자만 보는 '사용 기록'에 남긴다.
// 화면 보기와 접속은 /api/activity 가 따로 받는다. GET 은 남기지 않는다.
// 기록이 안 돼도 하던 일은 그대로 끝난다.
import { currentUser } from "../../server/auth";
import type { Env, User } from "../../server/auth";
import { detailOf, record, subjectOf, whereOf } from "../../server/activity";
import { withBackground } from "../../server/background";
import { canSim, earnFor } from "../../server/simcoin";
import { anonWrite } from "../../server/board";

/** 본문이 JSON 이 아닌 곳: 캐릭터 사진, AI 지우기(그림 파일)는 크기만 적는다 */
const BINARY = /^\/api\/(avatar(\/cutout)?|board\/\d+\/files)$/;

/**
 * 처리하다 예외가 나면 빈 500 대신 알 수 있는 글로 (2026-11-02: 장비대여 기부 적립이 '문제가 생겼어요 (500)'만 보여 원인을 몰랐다).
 * 앱개발자에게는 원인을 같이 보인다 (CLAUDE.md 챗봇 errorCause 와 같은 생각)
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  try {
    return await withBackground((p) => context.waitUntil(p), () => handle(context));
  } catch (e) {
    console.error("api failed", new URL(context.request.url).pathname, e);
    const me = await currentUser(context.env, context.request).catch(() => null);
    const cause = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: me?.role === "developer" ? `서버에서 문제가 생겼어요 (원인: ${cause.slice(0, 300)})` : "서버에서 문제가 생겼어요. 잠시 뒤에 다시 해 주세요" }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }
};

const handle: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const path = new URL(request.url).pathname;
  const method = request.method;
  // 사진 질문의 사진 먼저 읽기(/api/chat/peek)는 바로 뒤의 챗봇 질문이 남으므로 따로 남기지 않는다 (사진 본문을 두 번 풀지 않게).
  // 캐릭터 사진 AI 검수(/api/avatar/review)도 같은 AI 보정의 둘째 단계라 /api/avatar/cutout 한 줄로 남는다
  // 생일 콤보 실시간 저장(?live=1, 콤보 중 3초마다)은 남기지 않는다 (콤보가 끝날 때 한 번 남는다)
  // 헬스 루틴의 하는 중인 운동 저장(/api/fit/draft, 세트를 누를 때마다)도 남기지 않는다 (운동 끝이 한 번 남는다). 운영진 때리기도 3초마다 모아 보내서 남기지 않는다
  if (method === "GET" || method === "HEAD" || method === "OPTIONS" || path === "/api/activity" || path === "/api/chat/peek" || path === "/api/avatar/review" || path === "/api/push" || path === "/api/todo/digest" || path.startsWith("/api/alerts") || path.startsWith("/api/sim") || path === "/api/fit/draft" || path === "/api/smack" || (path === "/api/bday" && new URL(request.url).searchParams.has("live"))) return context.next();

  let me: User | null = null;
  let body: unknown = null;
  let subject: string | null = null;
  try {
    // 로그아웃, 글 지우기는 끝난 뒤에는 누구인지, 무슨 글인지 모르므로 먼저 본다 (둘을 한꺼번에)
    const size = Number(request.headers.get("content-length") ?? 0);
    // 그림 파일, 첨부가 큰 챗봇 질문은 크기만 적는다 (큰 본문을 두 번 풀면 서버 CPU 한도에 걸린다)
    const bodyP = BINARY.test(path) || (path === "/api/chat" && size > 150_000) ? Promise.resolve({ size: `${Math.round(size / 1024)}KB` }) : request.clone().json().catch(() => null);
    [me, subject, body] = await Promise.all([currentUser(env, request), subjectOf(env, path).catch(() => null), bodyP]);
  } catch {
    // 기록 준비가 안 돼도 하던 일은 한다
  }
  // 건의함 익명 글·댓글을 쓰거나 고친 일은 남기지 않는다 (길드마스터가 사용 기록으로 글쓴이를 알아내지 못하게, server/board.ts). 지우기는 끝난 뒤엔 모르므로 먼저 본다
  const anon = me ? await anonWrite(env, me, method, path, body).catch(() => false) : false;
  if (anon) return context.next();
  const res = await context.next();
  // 로그인은 틀린 것도 남긴다 (누가 몇 번 틀렸는지). 다른 실패는 남기지 않는다
  if (!res.ok && path !== "/api/login") return res;
  // 기록은 답을 돌려준 뒤에 적는다 (제작자 2026-11-04 '버튼 동작별로 반응이 늦다': 누를 때마다 기록 DB 를 두세 번 다녀온 뒤에야 답했다)
  const write = async () => {
    try {
      const where = whereOf(request);
      if (path === "/api/login") {
        // 로그인 본문에서는 아이디만 본다 (비밀번호는 남기지 않는다)
        const id = (body as { id?: unknown } | null)?.id;
        const detail = res.ok ? null : JSON.stringify({ failed: res.status });
        if (typeof id === "string" && id) await record(env, id.slice(0, 40), "act", "POST /api/login", detail, where);
      } else if (me) {
        await record(env, me.id, "act", `${method} ${decodeURIComponent(path)}`, detailOf(body, subject), where);
        // 시뮬레이터 행운 코인: 유의미한 일이면 (server/simcoin.ts)
        if (canSim(me)) await earnFor(env, me.id, method, path);
      }
    } catch {
      // 기록 실패는 무시한다
    }
  };
  if (typeof context.waitUntil === "function") context.waitUntil(write());
  else await write();
  return res;
};
