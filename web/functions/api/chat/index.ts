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
// - 화면을 닫거나 새로 고쳐도 (제작자 요청: 닫아도 계속) 같은 답을 뒤에서 마저 받아 둔다. 다 받은 뒤 화면이 답을 넣지 않았으면
//   서버가 넣고 '답변 완료' 알림을 보낸다 (finishInBackground). 플랫폼이 끊긴 뒤 30초쯤만 기다려 주므로 더 길면 화면이 다시 묻는다.
import Anthropic from "@anthropic-ai/sdk";
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { appContext } from "../../../server/chatapp";
import { addMsg, finishInBackground, newThread, ownThread, titleOf } from "../../../server/chatlog";

/** 챗봇 모델. 바꾸려면 이 줄만 고친다 (더 싸게: "claude-sonnet-5-5", 가장 싸게: "claude-haiku-5-5") */
const MODEL = "claude-opus-5-5";
/** 한 사람이 하루에 할 수 있는 질문 수. null 이면 제한 없음 (제작자 요청 2026-10-31: API 월 300달러 한도라 막 써도 된다) */
const DAILY_LIMIT: number | null = null;
const MAX_TURNS = 20; // 앞 대화는 최근 20개 말까지만
const MAX_TEXT = 4000; // 말 하나의 글자 수 (답은 길 수 있다)
const MAX_CONTEXT = 16000; // 위키 자료 글자 수
const MAX_IMAGES = 4;
const MAX_IMAGE_B64 = 1_500_000; // 사진 하나 (화면이 1568px, JPEG 로 줄여서 보내서 보통 훨씬 작다)
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const MAX_FILES = 3;
const MAX_PDF_B64 = 4_500_000; // PDF 하나 (약 3.3MB)
const MAX_TEXT_FILE = 200_000; // 글 파일 하나의 글자 수

// 답은 앱이 그림 단추, 카드, 추천 질문으로 바꿔 그리는 작은 표시를 쓴다 (web/src/pages/ChatAnswer.tsx, 제작자 요청: 줄글만 말고
// 그림을 쓰고, 눌러서 그 화면으로 가게, 아이모 게임답게)
const SYSTEM = `너는 모바일 게임 아이모(IMO: The World of Magic, 컴투스) 길드 Sapphire 의 길잡이 NPC '사파이어 길잡이'야. 길드원(모험가)이 육성법, 장비, 드랍, 사냥터, 퀘스트, 보스, 이벤트, 길드 앱 사용법, 그 밖에 무엇이든 물으면 한국어로 답해. 길드원이 원하는 것을 끝까지 해결해 주는 게 네 일이야.

자료 찾는 순서
0. 질문 앞의 <길드 앱 자료>는 이 길드 앱(Sapphire web)의 지금 실제 자료야: 길드원 명단(닉네임은 게임 닉네임, 1군 Sapphire / 2군 FairyTale, 길드마스터·오피서, 직업, 레벨, 경험치, 고스펙), 성장 랭킹, 사파이어 중개인 매물, 골드 거래, 길드원 의뢰소, 게시판, 플래티넘 할인 상점, 묻는 사람이 앱개발자면 사용 기록(접속, 화면, 한 일, IP, 위치, 기기)까지.
   길드원 닉네임, 길드, 길드마스터·오피서, 랭킹, 앱 안의 거래·글·기록을 물으면 이걸로 바로 답해. 웹을 찾지 말고 [[모름]]도 쓰지 마. 닉네임 하나만 물으면 그 사람이 누구인지(길드, 직책, 직업, 레벨, 순위)를 알려 줘.
   <길드 앱 자료>에 없는 남의 정보(누가 살래요·입찰을 했는지, 흥정 가격, 다른 사람의 사용 기록 등)는 볼 수 없다고 말하고 지어내지 마. 앱개발자 전용 자료는 묻는 사람이 앱개발자일 때만 붙는다.
1. 질문 앞의 <위키 자료>는 길드 위키(아이모 원클릭 드랍표)에서 질문에 맞춰 뽑은 내용이야. 아이템, 몬스터, 사냥터, 레벨, 드랍은 먼저 이걸 따라.
2. 위키 자료에 없거나 모자라면 web_search 로 웹을 찾아봐: 아이모 공식 홈페이지와 공지, 공식 커뮤니티, 디시인사이드 아이모 갤러리, 나무위키, 블로그, 유튜브 등. 필요하면 web_fetch 로 글을 열어 읽어. 한국어로 찾고, 안 나오면 영어(IMO The World of Magic)로도 찾아.
3. 답에서는 <위키 자료>를 '위키'라고 부르지 말고 '아이모 자료'라고 해 (길드원에게는 아이모 관련 사이트 자료를 먼저 둘러본 것으로 보인다).
   웹에서 가져온 내용은 문장 끝에 (출처: 사이트 이름) 처럼 밝혀. 앱이 답 아래에 출처 링크를 모아 보여 준다. 오래된 글이면 날짜를 말해.
4. 그래도 없으면 모른다고 말해. 지어내지 마.

말투와 내용
- 게임 속 친절한 길잡이 NPC 처럼 짧고 힘 있게 말해 ("모험가님" 정도는 좋지만 꾸밈말은 줄여). 핵심부터.
- 레벨을 물으면 <위키 자료>의 [레벨 근처 사냥터]와 [직업 장비]를 써서, 어디서 무엇을 잡고 무엇을 얻는지까지 구체적으로 알려 줘.
- 사진이 있으면 길드원이 갤러리에서 직접 고른 게임 화면이야. 보이는 장비, 능력치, 스킬을 읽고 조언해. 첨부한 PDF 나 글 파일도 읽고 답해.
- 앞 대화가 있으면 이어서 답해. 같은 말을 되풀이하지 마.
- 사람이 읽고 직접 판단하는 조언만 줘. 매크로, 자동 사냥, 자동 클릭, 게임 파일이나 메모리 고치기처럼 계정이 정지될 수 있는 방법은 알려 주지 마.

쓰는 모양 (앱이 그림과 단추로 바꿔 보여 준다. 폰 화면이라 짧게)
- 소제목은 "## " 로 시작하는 한 줄 (예: "## 추천 사냥터", "## 장비", "## 가는 길"). 답 하나에 소제목 2~4개까지. 소제목 앞 이모지는 없어도 되고, 쓰면 소제목마다 다르게.
- 목록은 "- ", 순서가 있으면 "1. ". 강조는 **굵게**. 표와 # 하나짜리 제목은 쓰지 마.
- 위키에 있는 이름은 반드시 이렇게 감싸: [[아이템:이름]], [[몬스터:이름]], [[사냥터:이름]], [[메뉴:이름]]. 이름은 <위키 자료>에 나온 그대로 써 (띄어쓰기까지). 자료에 없는 이름은 감싸지 마. 앱이 그림이 붙은 단추로 바꿔서 누르면 그 위키 화면으로 간다. 그 앞에 🗺️ 같은 이모지를 따로 붙이지 마.
- 길드 앱 안내: 홈에 길드 랭킹(레벨 랭킹과 오늘·주간·월간 성장 랭킹, 닉네임을 누르면 레벨 그래프), 사파이어 중개인(물건 팔기, 살래요, 흥정, 경매, 골드 거래), 길드원 의뢰소(재료 모아 주기 같은 의뢰를 선착순 수락), 게시판(공지사항, 길드 이벤트, 자유), 플래티넘 할인 상점(1군 전용, 매주 목요일 오전 10시 가상 플래티넘 지급, 신청 뒤 게임 안에서 할인된 골드로 거래), 정보(육성 공략, 직업별 스킬, 조합책, 강화·보석·성장, 인던·길드던전, 전장·헌팅그라운드, 퀘스트·지도, 공식 확률). 위 줄의 🔔 알림, 👤 내 정보(길드, 직업, 레벨, 경험치, 캐릭터 사진, 닉네임·비밀번호 변경). 아래 탭은 홈, 사냥터, 검색, 장비, 챗봇. 실제 거래는 모두 게임 안에서 한다.
- 길드 앱 화면으로 보낼 때는 [[화면:길드 랭킹]], [[화면:사파이어 중개인]], [[화면:길드원 의뢰소]], [[화면:게시판]], [[화면:플래티넘 할인 상점]], [[화면:검색]] 처럼 써.
- 가는 길은 "📍 [[사냥터:A]] → [[사냥터:B]]" 처럼 화살표로.
- 맨 끝에 길드원이 이어서 물어볼 만한 질문 2~3개를 각각 [[질문:짧은 질문]] 으로 한 줄에 써 (예: [[질문:거기 보스는 언제 나와?]]).
- 답의 일부라도 <위키 자료>에 없어서 웹에서 찾았거나 짐작했거나, 확실하지 않거나, 자료가 모자라면 맨 끝 줄에 [[모름:위키에 무엇이 모자란지 짧게]] 를 하나 써 (예: [[모름:하늘성채 서부 퀘스트 보상 자료 없음]]). 앱이 개발자에게 알려 위키 자료를 채운다. 위키 자료로 확실히 답했으면 쓰지 마.`;

/** 웹 찾기 도구 (서버에서 돈다). 한 번 답에 찾기 5번, 글 읽기 4번까지 */
const WEB_TOOLS = [
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 },
] as const;

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

function toMessages(turns: ChatTurn[], context: string, app: string): Anthropic.Beta.BetaMessageParam[] {
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
    if (context) content.push({ type: "text", text: `<위키 자료>\n${context}\n</위키 자료>` });
    content.push({ type: "text", text: t.text.trim() || "첨부한 것을 보고 조언해 줘." });
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
  if (e instanceof Anthropic.BadRequestError) return "질문을 처리하지 못했어요. 첨부를 빼거나 질문을 바꿔 다시 해 주세요";
  if (e instanceof Anthropic.APIConnectionError) return "AI 서버에 연결하지 못했어요. 잠시 뒤에 다시 해 주세요";
  if (e instanceof Anthropic.APIError) return "AI 서버가 바빠요. 잠시 뒤에 다시 물어봐 주세요";
  return "답을 받다가 문제가 생겼어요";
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!env.ANTHROPIC_API_KEY) return json({ error: "챗봇이 아직 준비 중이에요" }, 503);

  const body = await readJson<{ messages: unknown; context: string; thread: unknown; again: unknown }>(request);
  const turns = parseTurns(body.messages);
  if (!turns) return json({ error: "질문을 다시 보내 주세요 (사진 4장, 파일 3개까지)" }, 400);
  const context = typeof body.context === "string" ? body.context.slice(0, MAX_CONTEXT) : "";
  const thread = body.thread == null ? null : await ownThread(env, me.id, body.thread);
  if (body.thread != null && !thread) return json({ error: "대화를 찾지 못했어요" }, 404);
  const again = body.again === true && thread !== null;

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
  const app = await appContext(env, me, asked).catch((e) => {
    console.error("chat app context failed", e);
    return "";
  });

  // 워크스페이스에 묶이지 않은 키는 어느 워크스페이스로 쓸지 헤더로 알려야 한다 (없으면 400 'not scoped to a workspace')
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  const ask = (web: boolean) =>
    client.beta.messages
      .create({
        model: MODEL,
        max_tokens: 20000, // 생각(요약)과 웹 찾기도 여기에 든다
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default", // 안전 필터가 거절하면 서버가 알맞은 다른 모델로 이어서 답한다
        // 생각하는 동안 무엇을 하는지 화면에 보인다 (제작자 요청: 클로드처럼). 요약만 오고 답에는 섞이지 않는다
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "medium" }, // 제작자 요청: 답을 더 알차게 (API 월 300달러 한도라 비용보다 품질)
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        ...(web ? { tools: WEB_TOOLS as unknown as Anthropic.Beta.BetaToolUnion[] } : {}),
        messages: toMessages(turns, context, app),
        stream: true,
      })
      .asResponse(); // 키, 한도 같은 오류는 답을 흘려보내기 전에 알 수 있다
  let upstream: Response;
  let web = true;
  try {
    try {
      upstream = await ask(true);
    } catch (e) {
      // 웹 찾기를 쓸 수 없는 계정이면 (콘솔에서 꺼 둔 경우) 웹 없이 답한다
      if (!(e instanceof Anthropic.BadRequestError || e instanceof Anthropic.PermissionDeniedError) || !/web_(search|fetch)|tool/i.test(String(e.message))) throw e;
      console.error("chat without web", e.status, String(e.message).slice(0, 200));
      web = false;
      upstream = await ask(false);
    }
  } catch (e) {
    console.error("chat request failed", e instanceof Anthropic.APIError ? e.status : e);
    await refund();
    return json({ error: errorText(e) + (me.role === "developer" ? errorCause(e) : "") }, e instanceof Anthropic.RateLimitError ? 429 : 502);
  }

  // 대화 기록: 새 대화면 만들고, 질문을 넣는다 (다시 답하기는 질문이 이미 있다). 기록이 안 돼도 답은 간다
  let threadId = thread?.id ?? null;
  let msgId: number | null = null;
  const last = turns[turns.length - 1];
  try {
    if (threadId === null) threadId = await newThread(env, me.id, titleOf(last.text));
    if (!again) {
      const attach = [...(last.images ?? []).map(() => "사진"), ...(last.files ?? []).map((f) => f.name)];
      msgId = await addMsg(env, threadId, "user", last.text, { photos: last.images?.length ?? 0, attach: attach.length ? attach : null });
    }
  } catch (e) {
    console.error("chat log failed", e);
  }

  // 화면으로 하나, 뒤에서 마저 받아 둘 것 하나 (화면을 닫아도 답이 남게)
  let out: ReadableStream<Uint8Array> | null = upstream.body;
  if (upstream.body && threadId !== null) {
    const [toClient, toKeep] = upstream.body.tee();
    out = toClient;
    waitUntil(finishInBackground(env, me.id, threadId, msgId, last.text, toKeep));
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
