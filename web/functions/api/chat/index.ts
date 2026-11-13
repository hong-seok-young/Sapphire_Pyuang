// POST /api/chat { messages, context, thread?, again? } -> 챗봇 답을 Claude API 의 SSE 그대로 흘려보낸다 (text/event-stream)
//
// - 위키 자료는 화면(src/chat.ts)이 질문에 맞춰 골라 보낸다. 서버는 길이만 자르고 질문 앞에 붙인다.
// - 길드 앱 자료(길드원 명단, 랭킹, 중개인, 골드, 의뢰소, 게시판, 상점, 앱개발자면 사용 기록)는 서버가 D1 에서 읽어 붙인다
//   (server/chatapp.ts, 제작자 요청 2026-11-01: 길드원이 누군지 같은 앱 질문도 답하게). 묻는 사람이 앱에서 볼 수 있는 것만.
// - 위키에 없으면 길잡이가 웹을 찾아보고 읽는다 (web_search, web_fetch 서버 도구, 제작자 요청: 온라인을 다 뒤지고 출처를 밝히게).
// - 첨부: 사진(길드원이 갤러리에서 직접 고른 것), PDF, 글 파일. 앱은 화면을 캡처하지 않는다 (CLAUDE.md 게임 안전 규칙).
// - 답은 사람이 읽는 조언 글로만 돌려준다. 게임에 입력을 보내거나 시계 위에 띄우는 데 쓰지 않는다.
// - 서버는 답을 읽지 않고 API 응답을 그대로 넘긴다. 예전처럼 서버가 이벤트를 하나씩 풀면 무료 요금제의 CPU 한도에 걸려
//   긴 답이 중간에서 끊겼다 (제작자: '주'에서 끊김). 화면이 SSE 를 읽고 생각(요약), 웹 검색, 답을 그린다.
// - 대화 기록 (server/chatlog.ts): thread 가 없으면 새 대화를 만들고, 질문을 넣는다. again 이면 질문은 이미 있다 (다시 답하기).
//   대화 번호와 질문 번호는 머리글 x-chat-thread, x-chat-msg 로 알린다. 답은 화면이 다 받은 뒤 넣는다.
// - 앱을 닫아도 답은 끝까지 (제작자 2026-11-05 '내가 웹 꺼도 되게 하랬지'): 답 받기 일꾼(server/chatRun.ts, Durable Object)이 있으면
//   질문을 먼저 넣고 일꾼에게 맡긴다. 일꾼이 알람 안에서 15분까지 받아 대화에 넣고, 화면은 일꾼이 흘려 주는 SSE 를 받는다 (끊기면 /api/chat/live 로 다시 붙는다).
// - 일꾼이 없으면 예전 길: 같은 답을 뒤에서 마저 받아 두고 화면이 넣지 않았으면 서버가 넣는다 (finishInBackground, 화면이 끊긴 뒤 30초까지만).
import Anthropic from "@anthropic-ai/sdk";
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { appContext } from "../../../server/chatapp";
import { officialContext } from "../../../server/official";
import { CHAT_SYSTEM as SYSTEM, WEB_TOOLS, portalSearch } from "../../../server/chatPrompt";
import { costContext } from "../../../server/chatCost";
import { libraryContext } from "../../../server/library";
import { addMsg, finishInBackground, newThread, ownThread, runStub, titleOf } from "../../../server/chatlog";
import { cacheKey, cachedAnswer, cachedSse, routeSame, similarQuestion } from "../../../server/chatCache";
import { errorCause, errorText, isWebOff } from "../../../server/chatErrors";
import type { RunStart } from "../../../server/chatRun";

/** 챗봇 모델. 바꾸려면 이 줄만 고친다 (더 싸게: "claude-sonnet-5-5", 가장 싸게: "claude-haiku-5-5") */
const MODEL = "claude-opus-5-5";
/** 한 사람이 하루에 할 수 있는 질문 수. null 이면 제한 없음 (제작자 요청 2026-10-31: API 월 300달러 한도라 막 써도 된다) */
const DAILY_LIMIT: number | null = null;
const MAX_TURNS = 20; // 앞 대화는 최근 20개 말까지만
const MAX_TEXT = 4000; // 말 하나의 글자 수 (답은 길 수 있다)
const MAX_IMAGES = 4;
const MAX_IMAGE_B64 = 1_500_000; // 사진 하나 (화면이 1568px, JPEG 로 줄여서 보내서 보통 훨씬 작다)
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const MAX_FILES = 3;
const MAX_PDF_B64 = 4_500_000; // PDF 하나 (약 3.3MB)
const MAX_TEXT_FILE = 200_000; // 글 파일 하나의 글자 수

// 웹 찾기 도구(찾기 20번·읽기 15번, 한국에서)와 포털 검색 주소는 server/chatPrompt.ts (시험 스크립트와 같이 쓴다)

interface ChatImage {
  type: (typeof IMAGE_TYPES)[number];
  data: string;
}
/** 첨부 파일: PDF 는 base64, 글 파일은 글 그대로 */
interface ChatFile {
  kind: "pdf" | "text";
  name: string;
  data: string;
}
interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  images?: ChatImage[];
  files?: ChatFile[];
}

/** 화면이 보낸 대화를 검사한다. 사진과 파일은 마지막 질문에만 둔다. 맞지 않으면 null */
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
  const files = Array.isArray(last.files) ? last.files : [];
  if (files.length > MAX_FILES) return null;
  for (const f of files) {
    if (!f || (f.kind !== "pdf" && f.kind !== "text") || typeof f.name !== "string" || typeof f.data !== "string") return null;
    if (f.data.length > (f.kind === "pdf" ? MAX_PDF_B64 : MAX_TEXT_FILE)) return null;
  }
  const lastTurn = turns[turns.length - 1];
  lastTurn.images = images;
  lastTurn.files = files.map((f: ChatFile) => ({ kind: f.kind, name: f.name.slice(0, 100), data: f.data }));
  if (!lastTurn.text.trim() && !images.length && !files.length) return null;
  return turns;
}

function toMessages(turns: ChatTurn[], context: string, app: string, official = "", cost = "", library = ""): Anthropic.Beta.BetaMessageParam[] {
  return turns.map((t, i) => {
    if (i < turns.length - 1) return { role: t.role, content: t.text || "(첨부)" };
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...(t.images ?? []).map((img): Anthropic.Beta.BetaContentBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: img.type, data: img.data },
      })),
      ...(t.files ?? []).map(
        (f): Anthropic.Beta.BetaContentBlockParam =>
          f.kind === "pdf"
            ? { type: "document", title: f.name, source: { type: "base64", media_type: "application/pdf", data: f.data } }
            : { type: "document", title: f.name, source: { type: "text", media_type: "text/plain", data: f.data } },
      ),
    ];
    if (app) content.push({ type: "text", text: `<길드 앱 자료>\n${app}\n</길드 앱 자료>` });
    if (official) content.push({ type: "text", text: `<컴투스 공식 소식>\n${official}\n</컴투스 공식 소식>` });
    if (cost) content.push({ type: "text", text: `<과금 계산 자료>\n${cost}\n</과금 계산 자료>` });
    if (library) content.push({ type: "text", text: `<길드 자료 저장소>\n${library}\n</길드 자료 저장소>` });
    if (context) content.push({ type: "text", text: `<위키 자료>\n${context}\n</위키 자료>` });
    const portals = portalSearch(t.text);
    if (portals) content.push({ type: "text", text: `<포털 검색 주소>\n${portals}\n</포털 검색 주소>` });
    content.push({ type: "text", text: t.text.trim() || "첨부한 것을 보고 조언해 줘." });
    return { role: "user", content };
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!env.ANTHROPIC_API_KEY) return json({ error: "챗봇이 아직 준비 중이에요" }, 503);

  const body = await readJson<{ messages: unknown; context: string; thread: unknown; again: unknown; found: unknown; later: unknown }>(request);
  const turns = parseTurns(body.messages);
  if (!turns) return json({ error: "질문을 다시 보내 주세요 (사진 4장, 파일 3개까지)" }, 400);
  // 위키 자료는 자르지 않는다 (제작자 2026-11-03 '무조건 다 봐', '없애': 1만 6천 자 한도를 뺐다)
  const context = typeof body.context === "string" ? body.context : "";
  const thread = body.thread == null ? null : await ownThread(env, me.id, body.thread);
  if (body.thread != null && !thread) return json({ error: "대화를 찾지 못했어요" }, 404);
  const again = body.again === true && thread !== null;
  // 위키 자료는 질문 뒤에 따라온다 (/api/chat/context, 답 받기 일꾼이 기다린다). 일꾼이 없으면 자료와 같이 다시 보내라고 한다 (아무것도 넣기 전에)
  const later = body.later === true;
  if (later && !env.CHATRUN) return json({ needContext: true }, 409);

  // 같은 매물 글이면 앞서 누가 물은 답을 그대로 (server/chatCache.ts): 새 대화의 첫 질문, 사진·파일 없이. API 를 부르지 않는다
  const first = turns[turns.length - 1];
  const qkey = !thread && !again && turns.length === 1 && !first.images?.length && !first.files?.length ? await cacheKey(first.text).catch(() => null) : null;
  let hit = await cachedAnswer(env, qkey).catch(() => null);
  let followup: string | null = null;
  // 글이 조금 달라도: 낱말이 많이 겹치는 앞선 글이 있으면 짧은 API 한 번으로 같은 매물인지·따로 묻는 요청을 가린다 (못 가리면 보통대로)
  if (qkey && !hit) {
    const near = await similarQuestion(env, first.text).catch(() => null);
    const r = near ? await routeSame(env, near.question, first.text, me.id).catch((e) => (console.error("chat route failed", e), null)) : null;
    if (near && r?.same) {
      hit = await cachedAnswer(env, near.qkey).catch(() => null);
      followup = r.extra;
    }
  }
  if (hit) {
    const tid = await newThread(env, me.id, titleOf(first.text));
    const qid = await addMsg(env, tid, "user", first.text);
    const aid = await addMsg(env, tid, "assistant", hit.text, { found: hit.found, steps: hit.steps, sources: hit.sources });
    return new Response(cachedSse(hit.text, aid, followup), {
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-chat-thread": String(tid), "x-chat-msg": String(qid), "x-chat-cached": "1" },
    });
  }

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

  // 길드 앱 자료 (앞 질문까지 보고 고른다: '그 사람 레벨은?' 같은 이어 묻기). 못 읽어도 답은 한다
  const asked = turns.filter((t) => t.role === "user").slice(-2).map((t) => t.text).join("\n");
  const [app, official, cost, library] = await Promise.all([
    appContext(env, me, asked, Date.now(), request).catch((e) => {
      console.error("chat app context failed", e);
      return "";
    }),
    // 컴투스 공식 소식 (점검, 패치, 이벤트를 물을 때만, server/official.ts)
    officialContext(env, asked).catch((e) => {
      console.error("chat official context failed", e);
      return "";
    }),
    // 확률형 상품의 기대값·비용 계산 자료 (플래티넘 충전표, 골드 시세. server/chatCost.ts)
    costContext(env, asked).catch((e) => {
      console.error("chat cost context failed", e);
      return "";
    }),
    // 제작자가 자료 저장소에 올린 모든 글 자료 (카톡, 정리 글, 대화로 준 설명 …, server/library.ts)
    libraryContext(env, me, asked).catch((e) => {
      console.error("chat library context failed", e);
      return "";
    }),
  ]);

  // 워크스페이스에 묶이지 않은 키는 어느 워크스페이스로 쓸지 헤더로 알려야 한다 (없으면 400 'not scoped to a workspace')
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
    // 로컬 시험용 가짜 API (일꾼 없이 받는 길도 시험하려고. 실서비스에는 이 값이 없다)
    ...(env.CHAT_API_BASE ? { baseURL: env.CHAT_API_BASE } : {}),
  });
  // Claude API 요청 (웹 찾기를 못 쓰는 계정이면 tools 를 뺀다)
  const params = (web: boolean): Record<string, unknown> => ({
    model: MODEL,
    max_tokens: 32000, // 생각(요약)과 웹 찾기도 여기에 든다 (effort high 라 넉넉히)
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // 안전 필터가 거절하면 서버가 알맞은 다른 모델로 이어서 답한다
    // 생각하는 동안 무엇을 하는지 화면에 보인다 (제작자 요청: 클로드처럼). 요약만 오고 답에는 섞이지 않는다
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: "high" }, // 제작자 요청 2026-11-02 '비용 신경 쓰지 말고 무조건 퀄리티' (전에는 medium)
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    ...(web ? { tools: WEB_TOOLS } : {}),
    messages: toMessages(turns, context, app, official, cost, library),
  });
  const last = turns[turns.length - 1];

  // 답 받기 일꾼 (server/chatRun.ts, 제작자 2026-11-05 '내가 웹 꺼도 되게 하랬지'): 화면을 닫아도 15분까지 끝까지 받아 대화에 넣는다.
  // 일꾼이 없으면(배포 안 됨) 아래의 예전 길로 (화면이 끊긴 뒤 30초까지만)
  let threadId = thread?.id ?? null;
  let msgId: number | null = null;
  let logged = false;
  if (env.CHATRUN) {
    logged = true;
    try {
      if (threadId === null) threadId = await newThread(env, me.id, titleOf(last.text));
      if (!again) {
        const attach = [...(last.images ?? []).map(() => "사진"), ...(last.files ?? []).map((f) => f.name)];
        msgId = await addMsg(env, threadId, "user", last.text, { photos: last.images?.length ?? 0, attach: attach.length ? attach : null });
      }
    } catch (e) {
      console.error("chat log failed", e);
    }
    if (threadId !== null && (again || msgId !== null)) {
      const start: RunStart = {
        meta: {
          userId: me.id,
          threadId,
          question: last.text,
          found: typeof body.found === "string" ? body.found.slice(0, 400) : "",
          day,
          developer: me.role === "developer",
          ...(later ? { waitContext: true } : {}),
          ...(qkey ? { cacheKey: qkey } : {}),
        },
        params: params(true),
        key: env.ANTHROPIC_API_KEY,
        ...(workspace ? { workspace } : {}),
        ...(env.CHAT_API_BASE ? { baseURL: env.CHAT_API_BASE } : {}),
      };
      try {
        const res = await runStub(env.CHATRUN, threadId).fetch("https://chat-run/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(start),
        });
        if (res.ok && res.body) {
          return new Response(res.body, {
            headers: {
              "content-type": "text/event-stream; charset=utf-8",
              "cache-control": "no-store",
              "x-chat-run": "1",
              "x-chat-thread": String(threadId),
              ...(msgId !== null ? { "x-chat-msg": String(msgId) } : {}),
              ...(DAILY_LIMIT !== null ? { "x-chat-left": String(Math.max(0, DAILY_LIMIT - count)) } : {}),
            },
          });
        }
        console.error("chat run start failed", res.status);
      } catch (e) {
        console.error("chat run start failed", e);
      }
    }
    // 일꾼을 못 부르면 예전 길로 (질문은 이미 넣었다)
  }

  const ask = (web: boolean) =>
    client.beta.messages
      .create({ ...params(web), stream: true } as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming)
      .asResponse(); // 키, 한도 같은 오류는 답을 흘려보내기 전에 알 수 있다
  let upstream: Response;
  let web = true;
  try {
    try {
      upstream = await ask(true);
    } catch (e) {
      // 웹 찾기를 쓸 수 없는 계정이면 (콘솔에서 꺼 둔 경우) 웹 없이 답한다
      if (!isWebOff(e)) throw e;
      console.error("chat without web", String((e as Error).message).slice(0, 200));
      web = false;
      upstream = await ask(false);
    }
  } catch (e) {
    console.error("chat request failed", e instanceof Anthropic.APIError ? e.status : e);
    await refund();
    return json({ error: errorText(e) + (me.role === "developer" ? errorCause(e) : "") }, e instanceof Anthropic.RateLimitError ? 429 : 502);
  }

  // 대화 기록: 새 대화면 만들고, 질문을 넣는다 (다시 답하기는 질문이 이미 있다). 기록이 안 돼도 답은 간다
  if (!logged) {
    try {
      if (threadId === null) threadId = await newThread(env, me.id, titleOf(last.text));
      if (!again) {
        const attach = [...(last.images ?? []).map(() => "사진"), ...(last.files ?? []).map((f) => f.name)];
        msgId = await addMsg(env, threadId, "user", last.text, { photos: last.images?.length ?? 0, attach: attach.length ? attach : null });
      }
    } catch (e) {
      console.error("chat log failed", e);
    }
  }

  // 화면으로 하나, 뒤에서 마저 받아 둘 것 하나 (화면을 닫아도 답이 남게)
  let out: ReadableStream<Uint8Array> | null = upstream.body;
  if (upstream.body && threadId !== null) {
    const [toClient, toKeep] = upstream.body.tee();
    out = toClient;
    waitUntil(finishInBackground(env, me.id, threadId, msgId, last.text, toKeep, qkey));
  }
  return new Response(out, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      ...(web ? {} : { "x-chat-web": "off" }),
      ...(threadId !== null ? { "x-chat-thread": String(threadId) } : {}),
      ...(msgId !== null ? { "x-chat-msg": String(msgId) } : {}),
      ...(DAILY_LIMIT !== null ? { "x-chat-left": String(Math.max(0, DAILY_LIMIT - count)) } : {}),
    },
  });
};
