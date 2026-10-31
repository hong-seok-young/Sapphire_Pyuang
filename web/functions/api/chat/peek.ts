// POST /api/chat/peek { images } -> { job, level, names } : 사진 질문의 사진에서 직업, 레벨, 글자로 보이는 이름만 먼저 읽는다.
// 챗봇 개선 (2026-11-01, 퓨앙 사진 질문): 위키 자료는 화면(src/chat.ts)이 질문에 맞춰 고르는데, 사진만 보낸 질문은 레벨을 몰라
// 물은 사람이 적어 둔 레벨(Lv.50)로 골랐고, 사진 속 캐릭터는 Lv.34 마법사라 맞는 장비, 공략, 스킬이 빠졌다.
// 화면이 이 값으로 자료를 고른 뒤 같은 사진으로 /api/chat 에 묻는다. 길드원이 갤러리에서 직접 고른 사진만 받고
// (CLAUDE.md '해도 되는 것': 챗봇에 고른 스샷 올리기), 앱은 화면을 캡처하지 않는다. 읽은 값은 자료를 고르는 데만 쓰고 저장하지 않는다.
// 빠르고 싼 모델로 읽는다. 못 읽으면 빈 값을 주고, 화면은 물은 사람의 값으로 그대로 묻는다.
import Anthropic from "@anthropic-ai/sdk";
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";

const PEEK_MODEL = "claude-haiku-5-5";
const MAX_IMAGES = 4;
const MAX_IMAGE_B64 = 1_500_000;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const JOBS = ["전사", "레인저", "마법사", "무도가"];
const MAX_NAMES = 12;

const PROMPT = `이 사진은 모바일 게임 아이모(IMO) 화면이야. 보이는 것만 읽어서 JSON 한 줄로만 답해. 짐작하지 마.
{"job": 캐릭터 직업 "전사" | "레인저" | "마법사" | "무도가" | null, "level": 캐릭터 레벨 숫자 | null, "names": [화면에 글자로 보이는 아이템, 재료, 장비, 스킬, 몬스터, 사냥터, NPC 이름. 최대 ${MAX_NAMES}개]}
직업은 화면에 글자로 나오거나 스킬·장비로 분명할 때만, 레벨은 'Lv.34' 처럼 숫자가 보일 때만 적어. 사진이 여러 장이면 같이 보고 하나로 적어.`;

interface Seen {
  job: string | null;
  level: number | null;
  names: string[];
}

/** 모델 답에서 JSON 을 꺼내 검사한다. 맞지 않는 칸은 버린다 */
function parseSeen(text: string): Seen {
  const empty: Seen = { job: null, level: null, names: [] };
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return empty;
  try {
    const raw = JSON.parse(m[0]) as { job?: unknown; level?: unknown; names?: unknown };
    const level = Number(raw.level);
    return {
      job: typeof raw.job === "string" && JOBS.includes(raw.job) ? raw.job : null,
      level: Number.isInteger(level) && level >= 1 && level <= 200 ? level : null,
      names: Array.isArray(raw.names)
        ? [...new Set(raw.names.filter((n): n is string => typeof n === "string").map((n) => n.trim()).filter((n) => n.length >= 2 && n.length <= 30))].slice(0, MAX_NAMES)
        : [],
    };
  } catch {
    return empty;
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const empty: Seen = { job: null, level: null, names: [] };
  if (!env.ANTHROPIC_API_KEY) return json(empty);
  const body = await readJson<{ images: unknown }>(request);
  const images = Array.isArray(body.images) ? body.images : [];
  if (!images.length || images.length > MAX_IMAGES) return json({ error: "사진은 4장까지예요" }, 400);
  for (const img of images) {
    if (!img || !IMAGE_TYPES.includes(img.type) || typeof img.data !== "string" || img.data.length > MAX_IMAGE_B64) return json({ error: "사진을 다시 골라 주세요" }, 400);
  }
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  try {
    const res = await client.messages.create({
      model: PEEK_MODEL,
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img: { type: (typeof IMAGE_TYPES)[number]; data: string }): Anthropic.ImageBlockParam => ({
              type: "image",
              source: { type: "base64", media_type: img.type, data: img.data },
            })),
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return json(parseSeen(text));
  } catch (e) {
    console.error("chat peek failed", e instanceof Anthropic.APIError ? e.status : e);
    return json(empty);
  }
};
