// POST /api/ai/read { kind: "market" | "rental", image: { type, data } } -> 아이템 스샷에서 입력 칸에 넣을 값
// (제작자 요청 2026-11-02: 중개인은 위키에 없는 물건을 스샷으로 올리고, 장비대여 물건 추가는 스샷으로 칸을 채운다).
//   market: { name, enhance, category, enchant, enchantValue } (옵션은 읽지 않는다: 한 사람의 스샷만으로는 범위와 가짓수를 알 수 없어
//           데이터로 만들지 않고, 스샷 그림을 정보창처럼 보여 준다)
//   rental: { name, enhance, job, level, options: [{ name, value }] }
// 길드원이 갤러리에서 직접 고른 스샷만 받고 앱은 화면을 캡처하지 않는다. 읽은 값은 칸에 채울 뿐, 사람이 확인하고 저장한다
// (CLAUDE.md '해도 되는 것', 챗봇 사진 읽기(chat/peek.ts)와 같은 방법, 가장 좋은 모델). 한 사람 하루 kind 마다 30번 (D1 ai_usage).
import Anthropic from "@anthropic-ai/sdk";
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canEnter, isManager } from "../../../server/rental";
import { trackUsage } from "../../../server/apiUsage";

/** 제작자 요청 2026-11-02 '비용 신경 쓰지 말고 무조건 퀄리티': 가장 좋은 모델로 읽는다 */
const READ_MODEL = "claude-opus-5-5";
const MAX_IMAGE_B64 = 1_500_000;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const DAILY = 30;
const JOBS = ["전사", "레인저", "마법사", "무도가"];
const CATEGORIES = ["갑옷", "주장비", "투구", "보조장비", "장갑", "신발", "벨트", "망토", "목걸이", "반지", "가방", "소모품", "인챈트", "기타", "스킬북", "펫", "코스튬"];
const ENCHANTS = ["힘", "민첩", "지능", "체력", "마나"];
const OPTIONS = ["명중", "크리티컬", "힘", "민첩", "지능", "마나", "체력", "마나재생", "이동속도", "속성저항"];

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const SCHEMA = {
  market: {
    type: "object",
    properties: {
      name: nullable({ type: "string" }),
      enhance: nullable({ type: "integer" }),
      category: nullable({ type: "string", enum: CATEGORIES }),
      enchant: nullable({ type: "string", enum: ENCHANTS }),
      enchantValue: nullable({ type: "integer" }),
    },
    required: ["name", "enhance", "category", "enchant", "enchantValue"],
    additionalProperties: false,
  },
  rental: {
    type: "object",
    properties: {
      name: nullable({ type: "string" }),
      enhance: nullable({ type: "integer" }),
      job: nullable({ type: "string", enum: [...JOBS, "공용"] }),
      level: nullable({ type: "integer" }),
      options: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string", enum: OPTIONS }, value: { type: "integer" } },
          required: ["name", "value"],
          additionalProperties: false,
        },
      },
    },
    required: ["name", "enhance", "job", "level", "options"],
    additionalProperties: false,
  },
} as const;

const PROMPT = {
  market: `이 사진은 모바일 게임 아이모(IMO)의 아이템 정보창 스샷이야. 보이는 글자만 읽어서 채워. 짐작하지 마.
- name: 아이템 이름 (앞의 '+7' 같은 강화 숫자는 빼고, 화면에 적힌 그대로)
- enhance: 이름 앞 '+숫자' 강화 (없으면 0)
- category: 종류 (${CATEGORIES.join(", ")}). 무기는 주장비. 화면으로 분명하지 않으면 null
- enchant, enchantValue: 주황 글씨의 속성부여 ('힘 +2', '체력 +20' 같은 것). 없으면 둘 다 null`,
  rental: `이 사진은 모바일 게임 아이모(IMO)의 무기 정보창 스샷이야. 보이는 글자만 읽어서 채워. 짐작하지 마.
- name: 무기 이름 (앞의 '+7' 같은 강화 숫자는 빼고, 화면에 적힌 그대로)
- enhance: 이름 앞 '+숫자' 강화 (없으면 0)
- job: 착용 직업이 글자나 직업 그림으로 하나만 분명하면 (${JOBS.join(", ")}), 모든 직업이 쓰는 공용이 분명하면 공용, 아니면 null
- level: 요구 레벨 숫자, 안 보이면 null
- options: 이 무기에 붙은 옵션 값 (${OPTIONS.join(", ")}). 공격력, 공격 속도는 넣지 마. 값이 0 인 것도 넣지 마`,
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const body = await readJson<{ kind: unknown; image: unknown }>(request);
  const kind = body.kind === "rental" ? "rental" : body.kind === "market" ? "market" : null;
  if (!kind) return json({ error: "잘못된 요청이에요" }, 400);
  // 장비대여 물건 추가는 운영진만 (그 화면과 같은 권한)
  if (kind === "rental" && !(canEnter(me) && isManager(me))) return FORBIDDEN();
  const img = body.image as { type?: unknown; data?: unknown } | null;
  if (!img || !IMAGE_TYPES.includes(img.type as (typeof IMAGE_TYPES)[number]) || typeof img.data !== "string" || img.data.length > MAX_IMAGE_B64) {
    return json({ error: "스샷을 다시 골라 주세요" }, 400);
  }
  if (!env.ANTHROPIC_API_KEY) return json({ error: "스샷 읽기는 아직 준비 중이에요" }, 503);
  const day = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const used = await env.DB.prepare(
    "INSERT INTO ai_usage (user_id, day, kind, count) VALUES (?, ?, ?, 1) ON CONFLICT (user_id, day, kind) DO UPDATE SET count = count + 1 RETURNING count",
  )
    .bind(me.id, day, `read_${kind}`)
    .first<{ count: number }>();
  if ((used?.count ?? 1) > DAILY) return json({ error: `스샷 읽기는 하루 ${DAILY}번까지예요` }, 429);

  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  try {
    const res = await client.messages.create({
      model: READ_MODEL,
      max_tokens: 8000,
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA[kind] } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: img.type as (typeof IMAGE_TYPES)[number], data: img.data } },
            { type: "text", text: PROMPT[kind] },
          ],
        },
      ],
    });
    await trackUsage(env, me.id, `read_${kind}`, res);
    if (res.stop_reason === "refusal") return json({ error: "이 스샷은 읽지 못했어요" }, 422);
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const raw = JSON.parse(text) as Record<string, unknown>;
    // 맞지 않는 값은 버린다
    const name = typeof raw.name === "string" ? raw.name.replace(/^\+\d+\s*/, "").trim().slice(0, 30) : "";
    const enhance = Number.isInteger(raw.enhance) && (raw.enhance as number) >= 0 && (raw.enhance as number) <= 20 ? (raw.enhance as number) : null;
    if (kind === "market") {
      const enchant = typeof raw.enchant === "string" && ENCHANTS.includes(raw.enchant) ? raw.enchant : null;
      const value = Number(raw.enchantValue);
      return json({
        name: name || null,
        enhance,
        category: typeof raw.category === "string" && CATEGORIES.includes(raw.category) ? raw.category : null,
        enchant,
        enchantValue: enchant && Number.isInteger(value) && value > 0 && value <= 30 ? value : null,
      });
    }
    const level = Number(raw.level);
    const options = Array.isArray(raw.options)
      ? (raw.options as { name?: unknown; value?: unknown }[])
          .filter((o) => typeof o.name === "string" && OPTIONS.includes(o.name) && Number.isInteger(o.value) && (o.value as number) > 0 && (o.value as number) < 1000)
          .map((o) => ({ name: o.name as string, value: o.value as number }))
      : [];
    return json({
      name: name || null,
      enhance,
      job: typeof raw.job === "string" && (JOBS.includes(raw.job) || raw.job === "공용") ? raw.job : null,
      level: Number.isInteger(level) && level >= 1 && level <= 99 ? level : null,
      options,
    });
  } catch (e) {
    console.error("ai read failed", kind, e instanceof Anthropic.APIError ? `${e.status} ${String(e.message).slice(0, 200)}` : e);
    // 못 읽었으면 쓴 횟수를 되돌린다
    await env.DB.prepare("UPDATE ai_usage SET count = count - 1 WHERE user_id = ? AND day = ? AND kind = ? AND count > 0").bind(me.id, day, `read_${kind}`).run();
    return json({ error: "스샷을 읽지 못했어요. 직접 적어 주세요" }, 502);
  }
};
