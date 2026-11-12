// 같은 매물 글 답 다시 쓰기 (제작자 2026-11-12 '톡방에 매물이 올라오면 그거 복사해서 여러 명이 물어볼 거, 최초 한 번 물어본 사람의 결과를 가져와서 보여주면 API 비용 아낄 듯',
// '그거 붙이고 나서 다른 걸 요청하면 과거 결과를 보여 준 다음 그 다른 요청은 API 로').
// - 넣는 것: 새 대화의 첫 질문(사진·파일 없이)에 대한 답 중 도감 계산기·시세 칸([[도감:…]], [[시세:…]])이 든 것만. 그래서 '내 할 일' 같은 사람마다 다른 답은 안 들어간다.
// - 쓰는 것: 새 대화의 첫 질문이 앞서 누가 물은 글과 같으면(띄어쓰기·카톡 머리 '[닉네임] [오후 3:22]' 무시) API 를 부르지 않고 그 답을 이 대화에 그대로 넣는다. 3일 안의 것만 (시세가 바뀐다).
//   그 뒤 이어 묻는 것은 그 답을 대화 기록으로 들고 늘 API 로 답한다.
// - 글이 조금 달라도 (제작자 'api 를 부르되 토큰을 적게, 프롬프트가 뭔지 파악하는 api 를 간단히'): 낱말이 많이 겹치는 앞선 글이 있으면
//   짧은 API 한 번(routeSame, 위키·앱 자료·웹 찾기 없이 두 글만)으로 같은 매물인지와 매물 말고 따로 묻는 요청(extra)을 가린다.
//   같으면 처음 답을 쓰고, extra 가 있으면 화면이 그 요청만 이어서 API 로 묻는다 (sapphire_followup).
// - D1 chat_cache (qkey = 정리한 글의 SHA-256, msg_id = 처음 답, question = 처음 질문 글, hits)
import Anthropic from "@anthropic-ai/sdk";
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
export async function rememberAnswer(env: Env, key: string | undefined | null, msgId: number, text: string, question = ""): Promise<void> {
  if (!key || !CACHEABLE.test(text) || /\[\[모름:/.test(text)) return; // 짐작·모름이 든 답은 다시 쓰지 않는다
  await env.DB.prepare(
    "INSERT INTO chat_cache (qkey, msg_id, created_at, hits, question) VALUES (?, ?, ?, 0, ?) " +
      "ON CONFLICT (qkey) DO UPDATE SET msg_id = excluded.msg_id, created_at = excluded.created_at, hits = 0, question = excluded.question",
  )
    .bind(key, msgId, Date.now(), question.slice(0, 6000))
    .run();
}

export interface Cached {
  text: string;
  steps: string | null;
  sources: string | null;
  found: string | null;
}
/** qkey 로 그 답 (similarQuestion 으로 찾은 것) */
export const answerOf = (env: Env, key: string) => cachedAnswer(env, key);

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

/** 낱말(한글·영문 덩어리, 숫자) 모음 */
const words = (t: string) => new Set((t.toLowerCase().match(/[가-힣a-z]+|\d+(?:\.\d+)?/g) ?? []).filter((w) => w.length > 1 || /\d/.test(w)));

/** 낱말이 많이 겹치는 3일 안의 앞선 글 (앞선 글 낱말의 70% 넘게가 새 글에 있으면, 가장 많이 겹치는 것 하나) */
export async function similarQuestion(env: Env, q: string): Promise<{ qkey: string; question: string } | null> {
  const mine = words(q);
  if (mine.size < 5) return null;
  const { results } = await env.DB.prepare("SELECT qkey, question FROM chat_cache WHERE created_at > ? AND question IS NOT NULL ORDER BY created_at DESC LIMIT 300")
    .bind(Date.now() - CACHE_MS)
    .all<{ qkey: string; question: string }>();
  let best: { qkey: string; question: string } | null = null;
  let bestScore = 0.7;
  for (const r of results ?? []) {
    const ws = words(r.question);
    if (ws.size < 5) continue;
    let n = 0;
    for (const w of ws) if (mine.has(w)) n++;
    const score = n / ws.size;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

const ROUTE_SCHEMA = {
  type: "object",
  properties: { same: { type: "boolean" }, extra: { anyOf: [{ type: "string" }, { type: "null" }] } },
  required: ["same", "extra"],
  additionalProperties: false,
};

/** 두 글이 같은 매물인지, 새 글에 매물 말고 따로 묻는 것이 있는지 (짧은 API 한 번, 두 글만) */
export async function routeSame(env: Env, before: string, now: string): Promise<{ same: boolean; extra: string | null } | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}) });
  const prompt = `모바일 게임 아이모 길드 챗봇이야. 길드원들이 거래 톡방에 올라온 매물 글(캐릭터·아이템 판매 글)을 복사해서 물어봐.
아래 [앞선 글]에는 이미 답을 했어. [새 글]이 같은 매물인지 가려 줘.
- same: 같은 매물이면 true. 캐릭터·레벨·직업·스킬·도감 수치·아이템·옵션·가격·조건이 모두 같아야 해. 줄 순서, 띄어쓰기, 카톡 닉네임·시간 머리, 인사말, 연락처, 오타 차이는 무시해. 숫자 하나라도 다르면 false.
- extra: 새 글에 매물 글 말고 따로 묻는 요청이 있으면 그 요청만 한 문장으로 (예: "이 가격이면 사도 돼?", "마법사로 키우려면 뭐부터?"). "이거 어때", "얼마야", "계산해 줘"처럼 앞선 답이 이미 하는 것(도감 값·시세 판단)이면 null. 없으면 null.
JSON 한 줄로만.

[앞선 글]
${before}

[새 글]
${now}`;
  const ask = (schema: boolean) =>
    client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "low" as const, ...(schema ? { format: { type: "json_schema" as const, schema: ROUTE_SCHEMA } } : {}) },
      messages: [{ role: "user", content: prompt }],
    });
  let res: Anthropic.Message;
  try {
    res = await ask(true);
  } catch (e) {
    if (!(e instanceof Anthropic.BadRequestError)) throw e;
    res = await ask(false);
  }
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const o = JSON.parse(m[0]) as { same?: unknown; extra?: unknown };
  return { same: o.same === true, extra: typeof o.extra === "string" && o.extra.trim() ? o.extra.trim().slice(0, 300) : null };
}

/** 길드원이 '👎 별로'를 누르면 그 글의 답은 다시 쓰지 않는다 (처음 답이든 다시 쓴 답이든) */
export async function forgetAnswer(env: Env, question: string | null | undefined, msgId: number): Promise<void> {
  const key = question ? await cacheKey(question) : null;
  await env.DB.prepare("DELETE FROM chat_cache WHERE msg_id = ? OR qkey = ?").bind(msgId, key ?? "").run();
}

/** 다시 쓰는 답을 Claude API 와 같은 모양의 SSE 로 (화면은 보통 답처럼 그리고, sapphire_saved 로 이미 넣은 줄을 안다) */
export function cachedSse(text: string, savedId: number, followup: string | null = null): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const ev = (o: Record<string, unknown>) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  const body =
    ev({ type: "message_start", message: { id: "cached", role: "assistant", content: [] } }) +
    ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
    ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }) +
    ev({ type: "content_block_stop", index: 0 }) +
    ev({ type: "message_delta", delta: { stop_reason: "end_turn" } }) +
    ev({ type: "message_stop" }) +
    `data: ${JSON.stringify({ type: "sapphire_saved", id: savedId })}\n\n` +
    (followup ? `data: ${JSON.stringify({ type: "sapphire_followup", text: followup })}\n\n` : "");
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(body));
      c.close();
    },
  });
}
