// POST /api/chat { messages, context } -> 챗봇 답을 글자로 조금씩 흘려보낸다 (text/plain 스트림)
//
// - 위키 자료는 화면(src/chat.ts)이 질문에 맞춰 골라 보낸다. 서버는 길이만 자르고 질문 앞에 붙인다.
// - 사진은 길드원이 갤러리에서 직접 고른 스샷만 받는다. 앱은 화면을 캡처하지 않는다 (CLAUDE.md 게임 안전 규칙).
// - 답은 사람이 읽는 조언 글로만 돌려준다. 게임에 입력을 보내거나 시계 위에 띄우는 데 쓰지 않는다.
// - 한 사람이 하루(한국 시간)에 할 수 있는 질문 수를 정해 둔다 (API 비용). 답을 못 받은 질문은 세지 않는다.
// 끝에 알릴 일(거절, 길이 초과, 오류)이 있으면 글 뒤에 CONTROL 글자와 JSON 을 붙인다. 화면이 그걸 읽는다.
import Anthropic from "@anthropic-ai/sdk";
import { NEED_LOGIN, currentUser, json, readJson } from "../../server/auth";
import type { Env } from "../../server/auth";

/** 챗봇 모델. 바꾸려면 이 줄만 고친다 (더 싸게: "claude-sonnet-5-5", 가장 싸게: "claude-haiku-5-5") */
const MODEL = "claude-opus-5-5";
/** 한 사람이 하루에 할 수 있는 질문 수. null 이면 제한 없음 (제작자 요청 2026-10-31: API 월 300달러 한도라 막 써도 된다) */
const DAILY_LIMIT: number | null = null;
const MAX_TURNS = 10; // 앞 대화는 최근 10개 말까지만
const MAX_TEXT = 2000; // 말 하나의 글자 수
const MAX_CONTEXT = 12000; // 위키 자료 글자 수
const MAX_IMAGES = 2;
const MAX_IMAGE_B64 = 1_500_000; // 사진 하나 (화면이 1568px, JPEG 로 줄여서 보내서 보통 훨씬 작다)
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
/** 답 글 뒤에 붙는 알림의 시작 글자 (src/chat.ts 와 같아야 한다) */
const CONTROL = "\u001e";

const SYSTEM = `너는 모바일 게임 아이모(IMO: The World of Magic) 길드 Sapphire 의 위키 도우미야. 길드원이 육성법, 장비, 드랍, 사냥터, 퀘스트, 보스에 대해 물으면 한국어로 답해.

- 질문 앞의 <위키 자료>는 길드 위키(아이모 원클릭 드랍표)에서 질문에 맞춰 뽑은 내용이야. 아이템, 몬스터, 사냥터에 대한 사실은 이 자료를 먼저 따르고, 자료에 없으면 모른다거나 확실하지 않다고 말해. 지어내지 마.
- 사진이 있으면 길드원이 갤러리에서 직접 고른 게임 화면이야. 화면에 보이는 장비, 능력치, 스킬을 읽고 조언해.
- 폰으로 읽기 좋게 핵심부터 짧게 써. 필요하면 "- " 목록을 쓰고, 표나 # 제목은 쓰지 마.
- 사람이 읽고 직접 판단하는 조언만 줘. 매크로, 자동 사냥, 자동 클릭, 게임 파일이나 메모리 고치기처럼 게임 규칙을 어겨 계정이 정지될 수 있는 방법은 알려 주지 마.`;

interface ChatImage {
  type: (typeof IMAGE_TYPES)[number];
  data: string;
}
interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  images?: ChatImage[];
}

/** 화면이 보낸 대화를 검사한다. 사진은 마지막 질문에만 둔다. 맞지 않으면 null */
function parseTurns(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const turns: ChatTurn[] = [];
  for (const t of raw.slice(-MAX_TURNS)) {
    if (!t || (t.role !== "user" && t.role !== "assistant") || typeof t.text !== "string") return null;
    turns.push({ role: t.role, text: t.text.slice(0, MAX_TEXT) });
  }
  while (turns.length && turns[0].role !== "user") turns.shift(); // 첫 말은 질문이어야 한다
  const last = raw[raw.length - 1];
  if (!turns.length || turns[turns.length - 1].role !== "user") return null;
  const images = Array.isArray(last.images) ? last.images : [];
  if (images.length > MAX_IMAGES) return null;
  for (const img of images) {
    if (!img || !IMAGE_TYPES.includes(img.type) || typeof img.data !== "string" || img.data.length > MAX_IMAGE_B64) return null;
  }
  turns[turns.length - 1].images = images;
  if (!turns[turns.length - 1].text.trim() && !images.length) return null;
  return turns;
}

function toMessages(turns: ChatTurn[], context: string): Anthropic.Beta.BetaMessageParam[] {
  return turns.map((t, i) => {
    if (i < turns.length - 1) return { role: t.role, content: t.text || "(사진)" };
    const content: Anthropic.Beta.BetaContentBlockParam[] = (t.images ?? []).map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.type, data: img.data },
    }));
    if (context) content.push({ type: "text", text: `<위키 자료>\n${context}\n</위키 자료>` });
    content.push({ type: "text", text: t.text.trim() || "이 스샷을 보고 조언해 줘." });
    return { role: "user", content };
  });
}

/** 앱개발자에게만 붙이는 실제 오류 (상태 코드와 API 메시지, 키 같은 비밀값은 들어 있지 않다) */
function errorCause(e: unknown): string {
  if (e instanceof Anthropic.APIError) return ` [원인 ${e.status ?? "-"}: ${String(e.message).slice(0, 200)}]`;
  return ` [원인: ${String(e instanceof Error ? e.message : e).slice(0, 200)}]`;
}

/** 길드원에게 보여 줄 오류 글 */
function errorText(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return "챗봇 API 키에 문제가 있어요. 앱개발자에게 알려 주세요";
  }
  if (e instanceof Anthropic.RateLimitError) return "지금 질문이 몰렸어요. 잠시 뒤에 다시 물어봐 주세요";
  if (e instanceof Anthropic.BadRequestError) return "질문을 처리하지 못했어요. 사진을 빼거나 질문을 바꿔 다시 해 주세요";
  if (e instanceof Anthropic.APIConnectionError) return "AI 서버에 연결하지 못했어요. 잠시 뒤에 다시 해 주세요";
  if (e instanceof Anthropic.APIError) return "AI 서버가 바빠요. 잠시 뒤에 다시 물어봐 주세요";
  return "답을 받다가 문제가 생겼어요";
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!env.ANTHROPIC_API_KEY) return json({ error: "챗봇이 아직 준비 중이에요" }, 503);

  const body = await readJson<{ messages: unknown; context: string }>(request);
  const turns = parseTurns(body.messages);
  if (!turns) return json({ error: "질문을 다시 보내 주세요 (사진은 2장까지)" }, 400);
  const context = typeof body.context === "string" ? body.context.slice(0, MAX_CONTEXT) : "";

  // 오늘(한국 시간) 몇 번째 질문인지. 답을 못 받으면 되돌린다
  const day = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const used = await env.DB.prepare(
    "INSERT INTO chat_usage (user_id, day, count) VALUES (?, ?, 1) " +
      "ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 RETURNING count",
  )
    .bind(me.id, day)
    .first<{ count: number }>();
  const count = used?.count ?? 1;
  const refund = () =>
    env.DB.prepare("UPDATE chat_usage SET count = count - 1 WHERE user_id = ? AND day = ? AND count > 0").bind(me.id, day).run();
  if (DAILY_LIMIT !== null && count > DAILY_LIMIT) {
    await refund();
    return json({ error: `오늘 질문 ${DAILY_LIMIT}번을 다 썼어요. 내일 다시 물어봐 주세요` }, 429);
  }

  // 워크스페이스에 묶이지 않은 키는 어느 워크스페이스로 쓸지 헤더로 알려야 한다 (없으면 400 'not scoped to a workspace')
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 8000, // 비용 상한. 폰으로 읽는 답이라 이보다 길 일이 거의 없다
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // 안전 필터가 거절하면 서버가 알맞은 다른 모델로 다시 답한다
    output_config: { effort: "low" }, // 채팅은 낮은 노력으로도 충분하고 빠르고 싸다
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: toMessages(turns, context),
  });
  try {
    await stream.withResponse(); // 키, 한도 같은 오류는 답을 흘려보내기 전에 알 수 있다
  } catch (e) {
    console.error("chat request failed", e instanceof Anthropic.APIError ? e.status : e);
    await refund();
    return json({ error: errorText(e) + (me.role === "developer" ? errorCause(e) : "") }, e instanceof Anthropic.RateLimitError ? 429 : 502);
  }

  const enc = new TextEncoder();
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      let wrote = false;
      let end: { kind: string; message?: string } | null = null;
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(enc.encode(event.delta.text));
            wrote = true;
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") end = { kind: "refusal" };
        else if (final.stop_reason === "max_tokens") end = { kind: "max_tokens" };
      } catch (e) {
        console.error("chat stream failed", e instanceof Anthropic.APIError ? e.status : e);
        if (!wrote) await refund();
        end = { kind: "error", message: errorText(e) + (me.role === "developer" ? errorCause(e) : "") };
      }
      if (end) controller.enqueue(enc.encode(CONTROL + JSON.stringify(end)));
      controller.close();
    },
    cancel() {
      stream.abort();
    },
  });
  return new Response(out, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...(DAILY_LIMIT !== null ? { "x-chat-left": String(Math.max(0, DAILY_LIMIT - count)) } : {}),
    },
  });
};
