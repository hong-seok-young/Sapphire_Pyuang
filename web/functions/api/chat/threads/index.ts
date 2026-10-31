// GET /api/chat/threads?q= -> 내 챗봇 대화 목록 (고정 먼저, 최근 순). q 가 있으면 이름이나 말에 그 글이 든 대화만, 맞은 말 한 줄과 함께
import { NEED_LOGIN, currentUser, json } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_THREADS } from "../../../../server/chatlog";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 40) ?? "";
  if (!q) {
    const { results } = await env.DB.prepare(
      "SELECT id, title, pinned, updated_at FROM chat_threads WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT ?",
    )
      .bind(me.id, MAX_THREADS)
      .all<{ id: number; pinned: number }>();
    return json({ threads: results.map((t) => ({ ...t, pinned: t.pinned === 1 })) });
  }
  const like = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const { results } = await env.DB.prepare(
    "SELECT t.id, t.title, t.pinned, t.updated_at, " +
      "(SELECT m.text FROM chat_msgs m WHERE m.thread_id = t.id AND m.text LIKE ?2 ESCAPE '\\' ORDER BY m.id LIMIT 1) AS hit " +
      "FROM chat_threads t WHERE t.user_id = ?1 AND (t.title LIKE ?2 ESCAPE '\\' OR EXISTS " +
      "(SELECT 1 FROM chat_msgs m WHERE m.thread_id = t.id AND m.text LIKE ?2 ESCAPE '\\')) ORDER BY t.pinned DESC, t.updated_at DESC LIMIT 100",
  )
    .bind(me.id, like)
    .all<{ id: number; pinned: number; hit: string | null }>();
  return json({
    threads: results.map((t) => {
      // 맞은 곳 둘레만, 그림 단추 표시는 이름만 (src/pages/ChatAnswer.tsx)
      const plain = (t.hit ?? "")
        .replace(/\[\[(?:질문|모름):[^\]\n]*\]\]/g, "")
        .replace(/\[\[[^:\]\n]+:([^\]\n]+)\]\]/g, "$1")
        .replace(/[#*]/g, "")
        .replace(/\s+/g, " ");
      const at = plain.toLowerCase().indexOf(q.toLowerCase());
      const hit = at >= 0 ? (at > 20 ? "…" : "") + plain.slice(Math.max(0, at - 20), at + q.length + 40) : null;
      return { ...t, pinned: t.pinned === 1, hit };
    }),
  });
};
