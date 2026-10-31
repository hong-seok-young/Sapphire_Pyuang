// POST /api/shop/advise { question, plan } -> (오피서 이상) 예산 검토의 AI 도우미 (제작자 요청 2026-10-31).
// 길마나 오피서가 상황(현금, 남은 플래티넘, 원하는 방향)을 말로 적으면 Claude 가 상점 통 설정 안을 2~4개 낸다.
// 1군 비율은 웬만하면 그대로 두고, 고스펙 비율과 주당 지급은 그때그때 상황에 맞춰 유연하게 (소수점 둘째 자리까지).
// 고르면 화면이 PUT /api/shop 으로 그 안 그대로 저장한다. 손익 숫자는 화면이 같은 셈으로 다시 계산해서 보인다.
import Anthropic from "@anthropic-ai/sdk";
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { loadSettings, validPlat, validRatio } from "../../../server/platshop";

const MODEL = "claude-opus-5-5";
const MAX_QUESTION = 1000;

const SYSTEM = `너는 아이모 길드 Sapphire 의 '1군 전용 플래티넘 할인 상점' 예산 도우미다. 길마나 오피서가 상황을 말하면 상점 통 설정 안을 2~4개 낸다.

구조:
- 길마가 원스토어 할인(그때그때 다르다)으로 아이모 플래티넘을 현금 결제하고, 그 플래티넘으로 산 물건을 1군과 고스펙 길드원에게 할인된 골드로 넘긴다. 길드 자금이 따로 있는 게 아니다.
- 비율은 '플래티넘 100 = 몇 만 골드'. 시중은 market (보통 7). 1군은 ratio, 고스펙(더 할인받는 길드원)은 highRatio.
- 1군 길드원은 매주 weekPlat, 고스펙은 highWeekPlat 만큼 가상 플래티넘을 지갑에 받고, 그 안에서 산다.
- 들어오는 골드 = 1군 인원 x weekPlat x 주 / 100 x ratio 만 + 고스펙 인원 x highWeekPlat x 주 / 100 x highRatio 만.
- 쓴 돈을 골드로 = 결제액(원) x goldRate (1원당 골드). 손익 = 들어오는 골드 - 쓴 돈을 골드로. 남는 플래티넘은 1군 비율로 골드로 친다.

원칙:
- 1군 비율은 웬만하면 지금 값 근처로 두고, 고스펙 비율과 주당 지급을 상황(남은 플래티넘, 현금, 손익)에 맞춰 유연하게 조정한다. 사용자가 1군도 바꾸자고 하면 바꾼다.
- 비율은 소수점 둘째 자리까지 쓸 수 있다. 시중보다 높게 잡지 않는다 (할인 상점이다). 주당 지급은 0 이상의 정수.
- 안은 서로 성격이 다르게 (예: 손익 맞춤, 길드원 혜택 우선, 남은 플래티넘 소진). 각 안의 label 은 짧은 명사, reason 은 한두 문장으로 무엇을 바꾸고 결과가 어떤지(손익 어림 포함).
- answer 는 상황에 대한 짧은 조언 두세 문장. 모두 한국어, 존댓말.`;

/** 답의 모양 (구조화 출력) */
const SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          ratio: { type: "number" },
          highRatio: { type: "number" },
          weekPlat: { type: "integer" },
          highWeekPlat: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["label", "ratio", "highRatio", "weekPlat", "highWeekPlat", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["answer", "options"],
  additionalProperties: false,
} as const;

interface Option {
  label: string;
  ratio: number;
  highRatio: number;
  weekPlat: number;
  highWeekPlat: number;
  reason: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (RANK[me.role] < 1) return FORBIDDEN();
  if (!env.ANTHROPIC_API_KEY) return json({ error: "AI 키가 아직 없어요" }, 503);
  const b = await readJson<{ question: unknown; plan: unknown }>(request);
  const question = typeof b.question === "string" ? b.question.trim().slice(0, MAX_QUESTION) : "";
  if (!question) return json({ error: "상황이나 바라는 점을 적어 주세요" }, 400);
  const settings = await loadSettings(env);
  // 화면의 예산 검토 값 (인원, 기간, 할인율, 골드 비율, 사는 플래티넘과 결제액): 숫자만 골라 넘긴다
  const plan: Record<string, number> = {};
  if (b.plan && typeof b.plan === "object") {
    for (const [k, v] of Object.entries(b.plan as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) plan[k.slice(0, 40)] = v;
    }
  }
  const facts = JSON.stringify({
    지금_설정: {
      ratio: settings.ratio, highRatio: settings.highRatio, market: settings.market, weekPlat: settings.weekPlat, highWeekPlat: settings.highWeekPlat,
    },
    예산_검토_화면: plan,
  });

  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  let options: Option[] = [];
  let answer = "";
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `상황 숫자:\n${facts}\n\n요청:\n${question}` }],
    });
    if (res.stop_reason === "refusal") return json({ error: "AI 가 답하지 않았어요. 다르게 물어봐 주세요" }, 502);
    const text = res.content.find((c): c is Anthropic.Beta.BetaTextBlock => c.type === "text")?.text ?? "";
    const parsed = JSON.parse(text) as { answer?: unknown; options?: unknown };
    answer = typeof parsed.answer === "string" ? parsed.answer.slice(0, 1000) : "";
    options = (Array.isArray(parsed.options) ? (parsed.options as Option[]) : [])
      .map((o) => ({
        label: String(o.label ?? "").slice(0, 40),
        ratio: round2(Number(o.ratio)),
        highRatio: round2(Number(o.highRatio)),
        weekPlat: Math.round(Number(o.weekPlat)),
        highWeekPlat: Math.round(Number(o.highWeekPlat)),
        reason: String(o.reason ?? "").slice(0, 400),
      }))
      // 저장할 수 있는 값만 (PUT /api/shop 과 같은 검사)
      .filter((o) => o.label && validRatio(o.ratio) && validRatio(o.highRatio) && validPlat(o.weekPlat) && validPlat(o.highWeekPlat))
      .slice(0, 4);
  } catch (e) {
    console.error("shop advise failed", e instanceof Anthropic.APIError ? `${e.status} ${String(e.message).slice(0, 200)}` : e);
    const busy = e instanceof Anthropic.RateLimitError || (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500);
    return json({ error: busy ? "AI 가 바빠요. 잠시 뒤에 다시 물어봐 주세요" : "AI 에게 묻지 못했어요" }, busy ? 503 : 502);
  }
  if (!options.length) return json({ error: "쓸 수 있는 안이 안 나왔어요. 다르게 물어봐 주세요" }, 502);
  return json({ answer, options });
};
