// POST /api/board/polish { cat, title, body } -> { title, body } 공지·길드 이벤트 글을 공지 모양으로 다듬는다 (운영진, 제작자 요청 2026-11-02).
// 사실(날짜, 시각, 보상, 이름, 숫자)은 그대로 두고 지어내지 않는다. 다듬은 글은 화면이 칸에 넣어 주고, 올리기 전에 사람이 보고 고친다 ('되돌리기').
// 한 사람 하루 30번 (D1 ai_usage 'polish').
import Anthropic from "@anthropic-ai/sdk";
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";

const POLISH_MODEL = "claude-opus-5-5";
const DAILY = 30;
const TITLE_MAX = 80;
const BODY_MAX = 10000;

const SCHEMA = {
  type: "object",
  properties: { title: { type: "string" }, body: { type: "string" } },
  required: ["title", "body"],
  additionalProperties: false,
};

const SYSTEM = `너는 모바일 게임 아이모(IMO) 길드 Sapphire 의 운영진이 쓴 길드 공지·이벤트 글을 다듬는 사람이야.
- 운영진이 적은 사실(날짜, 요일, 시각, 장소, 보상, 사람 이름, 숫자, 조건)은 한 글자도 바꾸거나 빼지 말고, 없는 내용은 절대 지어내지 마.
- 읽기 쉬운 공지 모양으로: 첫 문단에 무엇인지 한두 문장, 그다음 내용이 있는 항목만 '■ 일시', '■ 장소', '■ 대상', '■ 보상', '■ 참여 방법', '■ 주의' 같은 줄로. 글에 없는 항목은 만들지 마.
- 존댓말 공지체로 짧고 분명하게. 꾸밈말, 이모지 남발, 과장은 쓰지 마. 마크다운 표나 #, ** 같은 기호는 쓰지 마 (게시판은 글자 그대로 보인다).
- 제목은 ${TITLE_MAX}자 안, 무엇인지 바로 알 수 있게. 원래 제목이 좋으면 그대로 둬.`;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (RANK[me.role] < 1) return FORBIDDEN();
  const b = await readJson<{ cat: unknown; title: unknown; body: unknown }>(request);
  if (b.cat !== "notice" && b.cat !== "event") return json({ error: "공지사항과 길드 이벤트 글만 다듬어요" }, 400);
  const title = typeof b.title === "string" ? b.title.trim().slice(0, TITLE_MAX) : "";
  const body = typeof b.body === "string" ? b.body.trim().slice(0, BODY_MAX) : "";
  if (body.length < 10) return json({ error: "내용을 조금 더 적어 주세요" }, 400);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "AI 다듬기는 아직 준비 중이에요" }, 503);
  const day = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const used = await env.DB.prepare(
    "INSERT INTO ai_usage (user_id, day, kind, count) VALUES (?, ?, 'polish', 1) ON CONFLICT (user_id, day, kind) DO UPDATE SET count = count + 1 RETURNING count",
  )
    .bind(me.id, day)
    .first<{ count: number }>();
  if ((used?.count ?? 1) > DAILY) return json({ error: `AI 다듬기는 하루 ${DAILY}번까지예요` }, 429);
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  try {
    const res = await client.beta.messages.create({
      model: POLISH_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // 제작자 요청 2026-11-02 '무조건 퀄리티': 높은 effort
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `[${b.cat === "notice" ? "공지사항" : "길드 이벤트"}]\n제목: ${title || "(없음)"}\n\n${body}` }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (res.stop_reason === "refusal") throw new Error("refusal");
    const out = JSON.parse(res.content.map((c) => (c.type === "text" ? c.text : "")).join("")) as { title?: unknown; body?: unknown };
    const newTitle = typeof out.title === "string" && out.title.trim() ? out.title.trim().slice(0, TITLE_MAX) : title;
    const newBody = typeof out.body === "string" && out.body.trim() ? out.body.trim().slice(0, BODY_MAX) : body;
    return json({ title: newTitle, body: newBody });
  } catch (e) {
    console.error("board polish failed", e instanceof Anthropic.APIError ? `${e.status} ${String(e.message).slice(0, 200)}` : e);
    await env.DB.prepare("UPDATE ai_usage SET count = count - 1 WHERE user_id = ? AND day = ? AND kind = 'polish' AND count > 0").bind(me.id, day).run();
    return json({ error: "다듬지 못했어요. 잠시 뒤에 다시 해 주세요" }, 502);
  }
};
