// POST /api/chat/threads/:id/msgs { text, thinking?, thinkMs?, found?, steps?, sources? } -> 다 받은 답을 대화에 넣는다 (화면이 보낸다)
// DELETE /api/chat/threads/:id/msgs?from=말번호 -> 그 말부터 뒤를 지운다 (다시 답하기, 질문 수정)
import { NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../../server/auth";
import type { Env } from "../../../../../server/auth";
import { GAP_TOKEN, MAX_ANSWER, MAX_THINKING, addMsg, ownThread, recordGap } from "../../../../../server/chatlog";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const t = await ownThread(env, me.id, paramId(params));
  if (!t) return json({ error: "대화를 찾지 못했어요" }, 404);
  const b = await readJson<{ text: unknown; thinking: unknown; thinkMs: unknown; found: unknown; steps: unknown; sources: unknown }>(request);
  if (typeof b.text !== "string" || !b.text.trim()) return json({ error: "답이 비었어요" }, 400);
  const id = await addMsg(env, t.id, "assistant", b.text.slice(0, MAX_ANSWER), {
    thinking: typeof b.thinking === "string" && b.thinking ? b.thinking.slice(0, MAX_THINKING) : null,
    thinkMs: typeof b.thinkMs === "number" && Number.isFinite(b.thinkMs) ? Math.max(0, Math.round(b.thinkMs)) : null,
    found: typeof b.found === "string" && b.found ? b.found.slice(0, 400) : null,
    steps: typeof b.steps === "string" && b.steps.length <= 4000 ? b.steps : null,
    sources: typeof b.sources === "string" && b.sources.length <= 6000 ? b.sources : null,
  });
  // 길잡이가 짐작했거나 자료가 없다고 표시했으면 앱개발자에게 (제작자 요청)
  const gaps = [...b.text.matchAll(GAP_TOKEN)].map((m) => m[1].trim()).filter(Boolean);
  if (gaps.length) await recordGap(env, me.id, t.id, id, b.text, gaps.join(" / "), "bot");
  return json({ id, gap: gaps.length > 0 }, 201);
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const t = await ownThread(env, me.id, paramId(params));
  if (!t) return json({ error: "대화를 찾지 못했어요" }, 404);
  const from = Number(new URL(request.url).searchParams.get("from"));
  if (!Number.isInteger(from) || from <= 0) return json({ error: "지울 말을 골라 주세요" }, 400);
  await env.DB.prepare("DELETE FROM chat_msgs WHERE thread_id = ? AND id >= ?").bind(t.id, from).run();
  return json({ ok: true });
};
