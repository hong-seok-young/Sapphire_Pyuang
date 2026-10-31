// 챗봇이 모르는 질문 (제작자 요청: 짐작하거나 자료가 없는 답을 개발자에게 알리고, 고친 뒤 물은 사람에게 알린다. server/chatlog.ts)
// GET /api/chat/gaps?status=open|fixed -> 목록 (앱개발자만)
// POST /api/chat/gaps { msg } -> 길드원이 내 대화의 답에 '👎 별로'를 눌렀을 때
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { recordGap } from "../../../../server/chatlog";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (me.role !== "developer") return FORBIDDEN();
  const status = new URL(request.url).searchParams.get("status") === "fixed" ? "fixed" : "open";
  const { results } = await env.DB.prepare(
    "SELECT id, user_id, thread_id, question, answer, reason, kind, status, note, created_at, fixed_at FROM chat_gaps WHERE status = ? " +
      `ORDER BY ${status === "open" ? "created_at" : "fixed_at"} DESC LIMIT 200`,
  )
    .bind(status)
    .all();
  return json({ gaps: results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const { msg } = await readJson<{ msg: unknown }>(request);
  const row = await env.DB.prepare(
    "SELECT m.id, m.thread_id, m.text FROM chat_msgs m JOIN chat_threads t ON t.id = m.thread_id WHERE m.id = ? AND m.role = 'assistant' AND t.user_id = ?",
  )
    .bind(Number(msg), me.id)
    .first<{ id: number; thread_id: number; text: string }>();
  if (!row) return json({ error: "답을 찾지 못했어요" }, 404);
  const done = await env.DB.prepare("SELECT 1 FROM chat_gaps WHERE msg_id = ? AND kind = 'user'").bind(row.id).first();
  if (!done) await recordGap(env, me.id, row.thread_id, row.id, row.text, "길드원이 별로라고 함", "user");
  return json({ ok: true });
};
