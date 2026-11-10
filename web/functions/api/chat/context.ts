// POST /api/chat/context { thread, context, found } -> 질문 뒤에 따라오는 위키 자료 (챗봇 개선 2026-11-09, 제작자 '질문하자마자 웹을 꺼도 알아서 답을 끝까지').
// 화면은 질문(사진 포함)을 누르자마자 /api/chat { later: true } 로 먼저 보내고, 위키 자료는 고르는 대로 여기로 보낸다.
// 답 받기 일꾼(server/chatRun.ts)은 자료를 120초(CONTEXT_WAIT_MS)까지 기다렸다가 붙여 답하고, 그 사이 앱을 껐으면 자료 없이(앱 자료·웹 찾기로) 끝까지 답한다
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { ownThread, runStub } from "../../../server/chatlog";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ thread: unknown; context: unknown; found: unknown }>(request);
  const t = await ownThread(env, me.id, b.thread);
  if (!t) return json({ error: "대화를 찾지 못했어요" }, 404);
  if (!env.CHATRUN) return json({ ok: false });
  const res = await runStub(env.CHATRUN, t.id)
    .fetch("https://chat-run/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: typeof b.context === "string" ? b.context : "", found: typeof b.found === "string" ? b.found.slice(0, 400) : "" }),
    })
    .catch(() => null);
  return json({ ok: !!res?.ok });
};
