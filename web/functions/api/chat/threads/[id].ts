// GET /api/chat/threads/:id -> 대화와 말 전부 / PATCH { title?, pinned? } -> 이름 변경, 고정 / DELETE -> 대화 삭제 (내 대화만)
import { NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { deleteThreads, ownThread } from "../../../../server/chatlog";

const NOT_FOUND = () => json({ error: "대화를 찾지 못했어요" }, 404);

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const t = await ownThread(env, me.id, paramId(params));
  if (!t) return NOT_FOUND();
  const { results } = await env.DB.prepare(
    "SELECT id, role, text, photos, thinking, think_ms, found, attach, steps, sources, created_at FROM chat_msgs WHERE thread_id = ? ORDER BY id",
  )
    .bind(t.id)
    .all();
  // 개선된 질문 (알림을 누르고 들어오면 화면이 새 답을 받는다)
  const fixed = await env.DB.prepare("SELECT id, question, note FROM chat_gaps WHERE thread_id = ? AND status = 'fixed'").bind(t.id).all();
  return json({ thread: { id: t.id, title: t.title, pinned: t.pinned === 1, updated_at: t.updated_at }, msgs: results, fixed: fixed.results });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const t = await ownThread(env, me.id, paramId(params));
  if (!t) return NOT_FOUND();
  const b = await readJson<{ title: unknown; pinned: unknown }>(request);
  if (typeof b.title === "string") {
    const title = b.title.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!title) return json({ error: "이름을 적어 주세요" }, 400);
    await env.DB.prepare("UPDATE chat_threads SET title = ? WHERE id = ?").bind(title, t.id).run();
  }
  if (typeof b.pinned === "boolean") await env.DB.prepare("UPDATE chat_threads SET pinned = ? WHERE id = ?").bind(b.pinned ? 1 : 0, t.id).run();
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const t = await ownThread(env, me.id, paramId(params));
  if (!t) return NOT_FOUND();
  await deleteThreads(env, [t.id]);
  return json({ ok: true });
};
