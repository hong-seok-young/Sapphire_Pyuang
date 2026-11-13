// 아이모 소식 글의 핵심 요약 (제작자 요청 2026-11-02: 공식 글이 너무 길다. 글 맨 위에 핵심 3줄, 패치노트는 내 직업 변경점).
// 글을 처음 연 사람이 부르면 Claude 가 읽고 D1 official_summary 에 둔다 (다음부터는 바로). 원문(official_news.src)이 바뀌면 다시 만든다.
// 여럿이 같이 열어도 한 번만 만든다 (claimed_at, 90초 안이면 다른 곳이 만드는 중). 공식 홈페이지의 공개 글을 읽을 뿐 게임은 읽지 않는다.
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./auth";
import { APP_USER, trackUsage } from "./apiUsage";

export const SUMMARY_MODEL = "claude-opus-5-5";
const JOBS = ["전사", "레인저", "마법사", "무도가"] as const;
const CLAIM_MS = 90_000;
/**
 * 요약을 만든 방법의 판. official_summary.src 에 원문 해시와 함께 둔다 ('<src>#s2', 그림을 다 옮기기 전이면 끝에 p).
 * 2 (2026-11-06 제작자 '시너지 다 하자'): 그림 속 표·글자까지 읽는다. 그림이 다 옮겨지면 다시 만든다
 */
export const SUMMARY_V = 2;
export const summaryKey = (src: string | null, complete: boolean) => `${src ?? ""}#s${SUMMARY_V}${complete ? "" : "p"}`;

export interface Summary {
  lines: string[];
  /** 직업마다 바뀐 점 (패치노트일 때만, 없으면 빈 배열) */
  jobs: Record<string, string[]>;
}

const SCHEMA = {
  type: "object",
  properties: {
    lines: { type: "array", items: { type: "string" } },
    jobs: {
      type: "object",
      properties: Object.fromEntries(JOBS.map((j) => [j, { type: "array", items: { type: "string" } }])),
      required: [...JOBS],
      additionalProperties: false,
    },
  },
  required: ["lines", "jobs"],
  additionalProperties: false,
};

const SYSTEM = `너는 모바일 게임 아이모(IMO) 길드 앱에서 컴투스 공식 공지를 길드원에게 짧게 정리해 주는 사람이야.
- lines: 이 글의 핵심을 1~3줄로. 한 줄은 40자 안쪽, 명사형으로 끝내고(예: '11/5(목) 10:30~15:00 정기 점검', '김선달 콜라보 이벤트 11/26까지'),
  기간·시각, 길드원이 할 일이나 받을 것, 바뀌는 점처럼 꼭 알아야 할 것만. 인사말, 사과문, 보상 목록 나열, 유의사항은 쓰지 마.
- jobs: 패치노트나 업데이트 글에서 직업마다 바뀐 점 (스킬, 밸런스, 장비 등)을 직업마다 5줄까지, 같은 모양의 짧은 명사형으로.
  직업과 상관없는 글이거나 그 직업의 변경이 없으면 빈 배열.
- 글에 없는 것은 지어내지 마. 날짜는 글에 적힌 그대로.
- 공식 글은 기간, 교환표, 확률 같은 중요한 내용이 그림에만 있는 일이 많다. 그림 속 글자는 본문의 그 자리에 [그림 속 글자] … [그림 끝] 으로 들어 있으니 본문과 똑같이 읽어.`;

/** 저장된 요약 (원문이 그대로일 때만). 만드는 중이면 "pending", 없으면 null */
export async function storedSummary(env: Env, id: number, src: string | null, now = Date.now()): Promise<Summary | "pending" | null> {
  const row = await env.DB.prepare("SELECT src, lines, jobs, claimed_at FROM official_summary WHERE id = ?")
    .bind(id)
    .first<{ src: string | null; lines: string | null; jobs: string | null; claimed_at: number | null }>();
  if (!row) return null;
  if (row.lines && row.src === src) return { lines: JSON.parse(row.lines) as string[], jobs: JSON.parse(row.jobs ?? "{}") as Record<string, string[]> };
  if (!row.lines && row.claimed_at && row.claimed_at > now - CLAIM_MS) return "pending";
  return null;
}

/** 요약을 만든다 (맡았을 때만). 못 맡으면 "pending" */
export async function makeSummary(
  env: Env,
  post: { id: number; title: string; type: string; body: string; src: string | null; start_date: string | null; end_date: string | null },
  now = Date.now(),
): Promise<Summary | "pending"> {
  // 맡기: 없으면 넣고, 있으면 다른 곳이 만드는 중이 아닐 때만 (원문이 바뀐 것도 여기서 다시 맡는다)
  const claim = await env.DB.prepare(
    "INSERT INTO official_summary (id, src, lines, jobs, claimed_at, created_at) VALUES (?1, ?2, NULL, NULL, ?3, NULL) " +
      "ON CONFLICT (id) DO UPDATE SET src = ?2, lines = NULL, jobs = NULL, claimed_at = ?3 " +
      "WHERE official_summary.claimed_at IS NULL OR official_summary.claimed_at < ?4 OR (official_summary.lines IS NOT NULL AND official_summary.src IS NOT ?2)",
  )
    .bind(post.id, post.src, now, now - CLAIM_MS)
    .run();
  if (!claim.meta.changes) return "pending";
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  const kind = post.type === "C" ? "점검" : post.type === "E" ? "이벤트" : "공지";
  try {
    const res = await client.beta.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // 제작자 요청 2026-11-02 '무조건 퀄리티': 높은 effort (생각도 max_tokens 에 든다)
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `[${kind}] ${post.title}${post.start_date ? ` (${post.start_date}${post.end_date ? ` ~ ${post.end_date}` : ""})` : ""}\n\n${post.body}`,
        },
      ],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    await trackUsage(env, APP_USER, "summary", res);
    if (res.stop_reason === "refusal") throw new Error("refusal");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const raw = JSON.parse(text) as { lines?: unknown; jobs?: Record<string, unknown> };
    const clean = (v: unknown, max: number) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 80)).filter(Boolean).slice(0, max) : [];
    const summary: Summary = {
      lines: clean(raw.lines, 3),
      jobs: Object.fromEntries(JOBS.map((j) => [j, clean(raw.jobs?.[j], 5)])),
    };
    await env.DB.prepare("UPDATE official_summary SET lines = ?, jobs = ?, created_at = ? WHERE id = ? AND claimed_at = ?")
      .bind(JSON.stringify(summary.lines), JSON.stringify(summary.jobs), Date.now(), post.id, now)
      .run();
    return summary;
  } catch (e) {
    // 다음에 연 사람이 다시 맡게 놓아 준다
    await env.DB.prepare("UPDATE official_summary SET claimed_at = NULL WHERE id = ? AND claimed_at = ? AND lines IS NULL").bind(post.id, now).run();
    throw e;
  }
}
