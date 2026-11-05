// GET /api/chat/live?thread=번호 -> 그 대화의 답 받기 일꾼(server/chatRun.ts)이 받는 중이거나 방금 받은 답의 SSE 를 처음부터 다시 보낸다.
// 화면이 끊겼다 돌아오거나(앱을 닫았다 열기, 다른 앱에 갔다 오기) 대화를 다시 열 때 붙는다. 일꾼이 없거나 받을 것이 없으면 204
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { ownThread, runStub } from "../../../server/chatlog";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const t = await ownThread(env, me.id, new URL(request.url).searchParams.get("thread"));
  if (!t) return json({ error: "대화를 찾지 못했어요" }, 404);
  if (!env.CHATRUN) return new Response(null, { status: 204 });
  const res = await runStub(env.CHATRUN, t.id)
    .fetch("https://chat-run/watch")
    .catch(() => null);
  if (!res || res.status !== 200 || !res.body) return new Response(null, { status: 204, headers: { "x-chat-run": "1" } });
  return new Response(res.body, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-chat-run": "1" } });
};
