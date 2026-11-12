// 같은 매물 글 답 다시 쓰기 (제작자 2026-11-12 '톡방에 매물이 올라오면 그거 복사해서 여러 명이 물어볼 거, 최초 한 번 물어본 사람의 결과를 가져와서 보여주면 API 비용 아낄 듯',
// '그거 붙이고 나서 다른 걸 요청하면 과거 결과를 보여 준 다음 그 다른 요청은 API 로').
// - 넣는 것: 새 대화의 첫 질문(사진·파일 없이)에 대한 답 중 도감 계산기·시세 칸([[도감:…]], [[시세:…]])이 든 것만. 그래서 '내 할 일' 같은 사람마다 다른 답은 안 들어간다.
// - 쓰는 것: 새 대화의 첫 질문이 앞서 누가 물은 글과 같으면(띄어쓰기·카톡 머리 '[닉네임] [오후 3:22]' 무시) API 를 부르지 않고 그 답을 이 대화에 그대로 넣는다. 3일 안의 것만 (시세가 바뀐다).
//   그 뒤 이어 묻는 것은 그 답을 대화 기록으로 들고 늘 API 로 답한다.
// - D1 chat_cache (qkey = 정리한 글의 SHA-256, msg_id = 처음 답, hits)
import type { Env } from "./auth";

export const CACHE_MS = 3 * 24 * 3_600_000;
const CACHEABLE = /\[\[(도감|시세):/;

export function cacheText(q: string): string {
  return q
    .split("\n")
    .map((l) => l.replace(/^\s*\[[^\]\n]{1,30}\]\s*\[(오전|오후)\s*\d{1,2}:\d{2}\]\s*/, ""))
    .join(" ")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export async function cacheKey(q: string): Promise<string | null> {
  const t = cacheText(q);
  if (t.length < 20) return null; // 짧은 질문은 사람마다 뜻이 다르다
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 처음 답을 적어 둔다 (도감·시세 칸이 든 답만) */
export async function rememberAnswer(env: Env, key: string | undefined | null, msgId: number, text: string): Promise<void> {
  if (!key || !CACHEABLE.test(text) || /\[\[모름:/.test(text)) return; // 짐작·모름이 든 답은 다시 쓰지 않는다
  await env.DB.prepare(
    "INSERT INTO chat_cache (qkey, msg_id, created_at, hits) VALUES (?, ?, ?, 0) ON CONFLICT (qkey) DO UPDATE SET msg_id = excluded.msg_id, created_at = excluded.created_at, hits = 0",
  )
    .bind(key, msgId, Date.now())
    .run();
}

export interface Cached {
  text: string;
  steps: string | null;
  sources: string | null;
  found: string | null;
}
/** 3일 안의 같은 글 답 */
export async function cachedAnswer(env: Env, key: string | null): Promise<Cached | null> {
  if (!key) return null;
  const row = await env.DB.prepare(
    "SELECT m.text, m.steps, m.sources, m.found FROM chat_cache c JOIN chat_msgs m ON m.id = c.msg_id WHERE c.qkey = ? AND c.created_at > ?",
  )
    .bind(key, Date.now() - CACHE_MS)
    .first<Cached>();
  if (!row?.text) return null;
  await env.DB.prepare("UPDATE chat_cache SET hits = hits + 1 WHERE qkey = ?").bind(key).run();
  return row;
}

/** 길드원이 '👎 별로'를 누르면 그 글의 답은 다시 쓰지 않는다 (처음 답이든 다시 쓴 답이든) */
export async function forgetAnswer(env: Env, question: string | null | undefined, msgId: number): Promise<void> {
  const key = question ? await cacheKey(question) : null;
  await env.DB.prepare("DELETE FROM chat_cache WHERE msg_id = ? OR qkey = ?").bind(msgId, key ?? "").run();
}

/** 다시 쓰는 답을 Claude API 와 같은 모양의 SSE 로 (화면은 보통 답처럼 그리고, sapphire_saved 로 이미 넣은 줄을 안다) */
export function cachedSse(text: string, savedId: number): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const ev = (o: Record<string, unknown>) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  const body =
    ev({ type: "message_start", message: { id: "cached", role: "assistant", content: [] } }) +
    ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
    ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }) +
    ev({ type: "content_block_stop", index: 0 }) +
    ev({ type: "message_delta", delta: { stop_reason: "end_turn" } }) +
    ev({ type: "message_stop" }) +
    `data: ${JSON.stringify({ type: "sapphire_saved", id: savedId })}\n\n`;
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(body));
      c.close();
    },
  });
}
