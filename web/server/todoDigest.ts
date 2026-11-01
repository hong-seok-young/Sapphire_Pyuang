// To do 의 이벤트 할 일 (제작자 요청 2026-11-01: 이벤트를 안 읽어도 본인 직업·레벨에 맞는 할 일을 명사형으로 딱).
// 공식 이벤트·공지 글 하나를 Claude 가 읽고 기간 안에 챙길 일만 짧게 뽑는다. 글마다 한 번만 하고(원문이 바뀌면 다시) 표 official_todo 에 둔다.
// 정리하는 곳이 둘이라 여기 하나로 둔다: scripts/digest-official.mjs (GitHub Actions, 시간 제한 없음, 주로 여기서)와
// 서버 functions/api/todo/digest.ts (To do 화면이 아직 정리 안 된 새 글을 볼 때). 제작자 요청: AI 는 비용보다 품질 (가장 좋은 모델, 높은 effort).
// 공식 홈페이지의 공개 글을 읽을 뿐 게임은 읽지 않는다 (CLAUDE.md 게임 안전 규칙). Node 가 타입을 지우고 그대로 읽으므로 상대 경로 import 는 두지 않는다.
import Anthropic from "@anthropic-ai/sdk";

export const DIGEST_MODEL = "claude-opus-5-5";

const JOBS_KO = ["전사", "레인저", "마법사", "무도가"] as const;
const JOB_KEY: Record<string, string> = { 전사: "warrior", 레인저: "ranger", 마법사: "mage", 무도가: "monk" };

const SYSTEM = `너는 모바일 MMORPG 아이모(IMO: The World Of Magic)의 공식 공지·이벤트 글을 읽고, 이 게임을 하는 길드원이 기간 안에 챙겨야 할 일만 뽑는다.
뽑은 줄은 길드 앱의 'To do' 화면에 체크 칸과 함께 그대로 보인다. 글을 안 읽어도 무엇을 하면 되는지 알게 쓰는 것이 목표다.

넣는 것 (기간이 정해진 것 중 게임 안에서 하는 일)
- 출석 보상 수령, 이벤트 퀘스트, 이벤트 아이템 모으기와 NPC 교환, 이벤트 제작, 이벤트 던전·보스, 핫타임 사냥, 쿠폰 입력, 이벤트 상점, 우편 보상 수령
- 시즌제 일정: 길드 점령전, 이노티아 워 경기처럼 정해진 요일·시각에 열리는 것 (한국어 서버, 한국 시간 기준)
- 게임 밖에서 응모하는 이벤트(SNS 인증, 스크린샷 응모, 설문, 퀴즈, 카카오톡 채널)는 '○○ 응모' 한 줄

넣지 않는 것
- 유료 결제, 패키지·상품·상자 판매와 뽑기, 원스토어 결제 프로모션과 포인트백, 결제 인증
- 확률 안내, 당첨·결과 발표, 보상 지급 안내(받는 사람이 따로 할 일이 없는 것), 오류 수정, 점검, 운영정책, 기능 설명
- 상시 콘텐츠의 기본 안내(인스턴스 던전, 길드 임무, 길드 출석, 길드 던전, 헌팅 그라운드 이용 시간): 앱이 따로 보여 준다

쓰는 법
- text: 할 일만 명사형으로 아주 짧게 (6~14자, 끝맺는 말 없이). 예: "출석 보상 수령", "으스스한장난감 교환", "해골가면 제작", "경험치 핫타임 사냥", "헌터증서 교환", "스크린샷 이벤트 응모"
- note: 어디서·무엇으로 하는지 아주 짧게 (예: "NPC 빅터", "이벤트 팝업", "해변의 전장"). 좌표는 쓰지 않는다. 없으면 null
- cycle: 기간 동안 매일 할 수 있으면 daily, 매주면 weekly, 한 번이면 once
- days, time: 정해진 요일·시각에만 열리는 것 (예: 화·토 22:30 길드 점령전 → days [2, 6], time "22:30", cycle daily). 요일 번호는 0 일, 1 월 … 6 토. 아니면 [] 와 null
- start, end: 그 일을 할 수 있는 때, "YYYY-MM-DD HH:MM" 한국 시간. 연도는 글 올린 날로 짐작한다.
  '점검 후'는 그날 12:00, '점검 전(까지)'는 그날 10:00, 끝 시각이 없으면 그날 23:59. 시작이 글에 없으면 글 올린 날 00:00. 끝을 모르면 null
- minLevel, maxLevel, jobs: 글에 참여 조건으로 적혀 있을 때만 (예: "Lv.30 이상" → minLevel 30, "마법사 전용" → jobs ["마법사"]). 아니면 null, null, []
- 한 글에서 6줄까지, 중요한 것부터. 같은 일을 여러 줄로 나누지 않는다. 한 글 안에 이벤트가 여럿이면 각각 (패치노트 안의 출석 이벤트, 핫타임 등)
- 할 일이 없으면 빈 배열`;

/** 답 모양 (API 가 이 모양을 지키게 한다) */
const TASKS_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          note: { anyOf: [{ type: "string" }, { type: "null" }] },
          cycle: { type: "string", enum: ["daily", "weekly", "once"] },
          days: { type: "array", items: { type: "integer" } },
          time: { anyOf: [{ type: "string" }, { type: "null" }] },
          start: { anyOf: [{ type: "string" }, { type: "null" }] },
          end: { anyOf: [{ type: "string" }, { type: "null" }] },
          minLevel: { anyOf: [{ type: "integer" }, { type: "null" }] },
          maxLevel: { anyOf: [{ type: "integer" }, { type: "null" }] },
          jobs: { type: "array", items: { type: "string", enum: [...JOBS_KO] } },
        },
        required: ["text", "note", "cycle", "days", "time", "start", "end", "minLevel", "maxLevel", "jobs"],
        additionalProperties: false,
      },
    },
  },
  required: ["tasks"],
  additionalProperties: false,
};

/** 표 official_todo.tasks 에 두는 할 일 하나 (화면과 서버가 읽기 쉽게 줄인 모양) */
export interface TodoTask {
  /** 할 일 (명사형) */
  t: string;
  /** 어디서 (짧게) */
  n: string | null;
  /** d 매일, w 매주(목 10시), o 한 번 */
  c: "d" | "w" | "o";
  /** 정해진 요일만 (0 일 … 6 토, 한국 시간). 비면 날마다 */
  days: number[];
  /** 정해진 시각 'HH:MM' */
  at: string | null;
  /** 할 수 있는 때 (ms) */
  s: number | null;
  e: number | null;
  /** [최소, 최대] 레벨 */
  lv: [number | null, number | null];
  /** 직업 (warrior, ranger, mage, monk). 비면 모두 */
  jobs: string[];
}

/** 정리할 글 */
export interface DigestPost {
  id: number;
  kind: string;
  type: string;
  title: string;
  start_date: string | null;
  body: string;
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
/** "YYYY-MM-DD HH:MM" (한국 시간) -> ms */
function kstTime(s: unknown): number | null {
  const m = typeof s === "string" ? /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s.trim()) : null;
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0) - 9, Number(m[5] ?? 0));
  return Number.isFinite(ms) ? ms : null;
}
const level = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 200 ? (v as number) : null);
const short = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** 모델 답 -> 할 일 목록 (맞지 않는 줄은 버린다) */
export function normalizeTasks(raw: unknown): TodoTask[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { tasks?: unknown }).tasks) ? (raw as { tasks: unknown[] }).tasks : [];
  const out: TodoTask[] = [];
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const t = short(r.text, 30);
    if (!t) continue;
    const cycle = r.cycle === "daily" ? "d" : r.cycle === "weekly" ? "w" : "o";
    const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
    const at = typeof r.time === "string" && /^\d{1,2}:\d{2}$/.test(r.time.trim()) ? r.time.trim().padStart(5, "0") : null;
    const s = kstTime(r.start);
    let e = kstTime(r.end);
    if (s !== null && e !== null && e <= s) e = null;
    out.push({
      t,
      n: short(r.note, 24) || null,
      // 정해진 요일에 열리는 일은 그날 할 일
      c: days.length ? "d" : cycle,
      days,
      at,
      s,
      e,
      lv: [level(r.minLevel), level(r.maxLevel)],
      jobs: Array.isArray(r.jobs) ? r.jobs.map((j) => JOB_KEY[String(j)]).filter((j): j is string => !!j) : [],
    });
    if (out.length >= 6) break;
  }
  return out;
}

/** 할 일이 끝나는 가장 늦은 때 (끝을 모르는 일이 있으면 글 올린 날 + 30일, 할 일이 없으면 0) */
export function tasksUntil(tasks: TodoTask[], postDate: string | null): number {
  if (!tasks.length) return 0;
  const posted = kstTime(postDate) ?? Date.now();
  return Math.max(...tasks.map((t) => t.e ?? Math.max(posted, t.s ?? 0) + 30 * 86_400_000));
}

/** 글 하나를 Claude 에 맡겨 할 일을 뽑는다. 거절당하면 빈 목록, API 오류는 던진다 (나중에 다시) */
export async function digestPost(client: Anthropic, post: DigestPost): Promise<TodoTask[]> {
  const posted = post.start_date ?? "";
  const dow = /^\d{4}-\d{2}-\d{2}$/.test(posted) ? DOW[new Date(posted + "T00:00:00Z").getUTCDay()] : "";
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        `글 올린 날: ${posted}${dow ? ` (${dow})` : ""}\n종류: ${post.kind === "event" ? "이벤트" : "공지사항"}\n제목: ${post.title}\n\n본문:\n` +
        post.body.slice(0, 20_000),
    },
  ];
  // 제작자 요청: 품질이 먼저 (기간·조건을 잘못 읽으면 할 일이 틀린다). 안전 필터가 거절하면 서버가 알맞은 다른 모델로 이어서 한다 (fallbacks)
  const format = { type: "json_schema" as const, schema: TASKS_SCHEMA };
  let res: Anthropic.Beta.BetaMessage | Anthropic.Message;
  try {
    res = await client.beta.messages.create({
      model: DIGEST_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format },
      system: SYSTEM,
      messages,
    });
  } catch (e) {
    // 이 계정이나 모델이 그 조합을 받지 않으면: 대신 거절 이어받기 없이, 그래도 안 되면 답 모양 지정 없이 글에서 JSON 을 꺼낸다
    if (!(e instanceof Anthropic.BadRequestError)) throw e;
    try {
      res = await client.messages.create({ model: DIGEST_MODEL, max_tokens: 16000, output_config: { effort: "high", format }, system: SYSTEM, messages });
    } catch (e2) {
      if (!(e2 instanceof Anthropic.BadRequestError)) throw e2;
      res = await client.messages.create({
        model: DIGEST_MODEL,
        max_tokens: 16000,
        output_config: { effort: "high" },
        system: SYSTEM + `\n\n답은 다른 말 없이 JSON 한 덩어리로만: {"tasks": [{"text", "note", "cycle", "days", "time", "start", "end", "minLevel", "maxLevel", "jobs"}]}`,
        messages,
      });
    }
  }
  if (res.stop_reason === "refusal") return [];
  if (res.stop_reason === "max_tokens") throw new Error("답이 길어 잘렸어요");
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return normalizeTasks(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
}

/** 정리할 글인지 (제목만 봐도 할 일이 없는 글은 모델에 보내지 않는다) */
export const NO_TODO_TITLE = /결과\s*발표|당첨자\s*(발표|안내)|지급\s*(안내|완료)|사전\s*예고|개인정보|운영\s*정책/;

/** 클라이언트 (워크스페이스에 묶이지 않은 키는 워크스페이스를 헤더로 알린다, functions/api/chat 과 같다) */
export function digestClient(apiKey: string, workspace?: string | null): Anthropic {
  const ws = workspace?.trim();
  return new Anthropic({ apiKey, maxRetries: 3, ...(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {}) });
}
