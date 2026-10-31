// PATCH /api/chat/gaps/:id { note? } -> 개선 완료 (앱개발자만). 물은 사람에게 '챗봇이 개선됐어요' 알림, 누르면 그 대화에서 새 답을 받는다
import { FORBIDDEN, NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (me.role !== "developer") return FORBIDDEN();
  const gap = await env.DB.prepare("SELECT id, user_id, thread_id, question, status FROM chat_gaps WHERE id = ?")
    .bind(Number(paramId(params)))
    .first<{ id: number; user_id: string; thread_id: number; question: string; status: string }>();
  if (!gap) return json({ error: "없는 질문이에요" }, 404);
  if (gap.status === "fixed") return json({ ok: true });
  const { note } = await readJson<{ note: unknown }>(request);
  const text = typeof note === "string" ? note.trim().slice(0, 200) : "";
  await env.DB.prepare("UPDATE chat_gaps SET status = 'fixed', note = ?, fixed_at = ? WHERE id = ?").bind(text || null, Date.now(), gap.id).run();
  const thread = await env.DB.prepare("SELECT 1 FROM chat_threads WHERE id = ? AND user_id = ?").bind(gap.thread_id, gap.user_id).first();
  const q = gap.question.replace(/\s+/g, " ").slice(0, 40);
  await notify(
    env,
    [gap.user_id],
    "chat_fixed",
    `챗봇이 개선됐어요. 물어봤던 “${q}”${text ? ` · ${text}` : ""}`,
    thread ? `#/chat/${gap.thread_id}?again=${gap.id}` : "#/chat",
    me.id,
  );
  return json({ ok: true });
};
