// POST /api/chat/stop { thread } -> 화면의 '중지': 그 대화의 답 받기 일꾼(server/chatRun.ts)이 받기를 멈춘다 (받은 데까지는 화면이 넣는다)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { ownThread, runStub } from "../../../server/chatlog";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ thread: unknown }>(request);
  const t = await ownThread(env, me.id, b.thread);
  if (!t) return json({ error: "대화를 찾지 못했어요" }, 404);
  if (env.CHATRUN) await runStub(env.CHATRUN, t.id).fetch("https://chat-run/stop", { method: "POST" }).catch(() => null);
  return json({ ok: true });
};
