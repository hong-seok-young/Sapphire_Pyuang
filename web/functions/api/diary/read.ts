// POST /api/diary/read { image: { type, data(base64) } } -> { level, exp, time } : 사용자가 갤러리에서 고른 게임 스샷에서 레벨·경험치 %·게임 시각을 AI 가 읽어 칸을 채운다
// (CLAUDE.md '아이템 스샷을 AI 가 읽어 입력 칸을 채우는 것'과 같은 조건: 앱은 화면을 찍지 않고, 읽은 값은 사람이 보고 고친다).
// 비공개 일지라 AI 사용량(api_usage, ai_usage)·사용 기록 어디에도 남기지 않는다 (server/diary.ts)
import Anthropic from "@anthropic-ai/sdk";
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { NOPE, canUseDiary } from "../../../server/diary";

const MODEL = "claude-opus-5-5";
const MAX_IMAGE_B64 = 2_000_000;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const SCHEMA = {
  type: "object",
  properties: {
    level: nullable({ type: "integer" }),
    exp: nullable({ type: "number" }),
    time: nullable({ type: "string" }),
  },
  required: ["level", "exp", "time"],
  additionalProperties: false,
};

const PROMPT = `이 사진은 모바일 게임 아이모(IMO)의 플레이 화면 스샷이야. 보이는 글자만 읽어서 채워. 짐작하지 마.
- level: 왼쪽 위 캐릭터 얼굴 그림 바로 아래 숫자 (캐릭터 레벨, 예: 42)
- exp: 화면 맨 아래 가운데 '경험치 89.819 %' 의 숫자 (소수점 셋째 자리까지 그대로, 예: 89.819)
- time: 왼쪽 위 체력·마나 막대 오른쪽의 시각 'HH:MM:SS' (예: 10:59:38). 앞이 가려져 일부만 보이면 보이는 숫자로 짐작하지 말고 null
안 보이면 null.`;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  const body = await readJson<{ image: unknown }>(request);
  const img = body.image as { type?: unknown; data?: unknown } | null;
  if (!img || !IMAGE_TYPES.includes(img.type as (typeof IMAGE_TYPES)[number]) || typeof img.data !== "string" || img.data.length > MAX_IMAGE_B64)
    return json({ error: "스샷을 다시 골라 주세요" }, 400);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "스샷 읽기는 아직 준비 중이에요" }, 503);
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}) });
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: img.type as (typeof IMAGE_TYPES)[number], data: img.data } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    if (res.stop_reason === "refusal") return json({ error: "이 스샷은 읽지 못했어요. 직접 적어 주세요" }, 422);
    const raw = JSON.parse(res.content.map((b) => (b.type === "text" ? b.text : "")).join("")) as Record<string, unknown>;
    const level = Number(raw.level);
    const exp = Number(raw.exp);
    const time = typeof raw.time === "string" && /^\d{1,2}:\d{2}(:\d{2})?$/.test(raw.time.trim()) ? raw.time.trim() : null;
    return json({
      level: Number.isInteger(level) && level >= 1 && level <= 99 ? level : null,
      exp: raw.exp !== null && Number.isFinite(exp) && exp >= 0 && exp <= 100 ? Math.round(exp * 1000) / 1000 : null,
      time,
    });
  } catch (e) {
    console.error("diary read failed", e instanceof Anthropic.APIError ? `${e.status}` : "");
    return json({ error: "스샷을 읽지 못했어요. 직접 적어 주세요" }, 502);
  }
};
