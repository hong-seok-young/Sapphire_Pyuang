// To do 의 이벤트 할 일 (제작자 요청 2026-11-01: 이벤트를 안 읽어도 본인 직업·레벨에 맞는 할 일을 명사형으로 딱).
// 공식 이벤트·공지 글 하나를 Claude 가 읽고 기간 안에 챙길 일만 짧게 뽑는다. 글마다 한 번만 하고(원문이 바뀌면 다시) 표 official_todo 에 둔다.
// 정리하는 곳이 둘이라 여기 하나로 둔다: scripts/digest-official.mjs (GitHub Actions, 시간 제한 없음, 주로 여기서)와
// 서버 functions/api/todo/digest.ts (To do 화면이 아직 정리 안 된 새 글을 볼 때). 제작자 요청: AI 는 비용보다 품질 (가장 좋은 모델, 높은 effort).
// 공식 홈페이지의 공개 글을 읽을 뿐 게임은 읽지 않는다 (CLAUDE.md 게임 안전 규칙). Node 가 타입을 지우고 그대로 읽으므로 상대 경로 import 는 두지 않는다.
import Anthropic from "@anthropic-ai/sdk";

export const DIGEST_MODEL = "claude-opus-5-5";
/** 정리한 모델과 지시문의 판 (official_todo.model). 지시문을 고치면 판을 올린다: 예전 판으로 정리한 글은 모두 다시 정리된다 */
export const DIGEST_TAG = `${DIGEST_MODEL}#6`;

const JOBS_KO = ["전사", "레인저", "마법사", "무도가"] as const;
const JOB_KEY: Record<string, string> = { 전사: "warrior", 레인저: "ranger", 마법사: "mage", 무도가: "monk" };

const SYSTEM = `너는 모바일 MMORPG 아이모(IMO: The World Of Magic)의 공식 공지·이벤트 글을 읽고, 이 게임을 하는 길드원이 기간 안에 챙겨야 할 일만 뽑는다.
뽑은 줄은 길드 앱의 'To do' 화면에 체크 칸과 함께 그대로 보인다. 글을 안 읽어도 무엇을 하면 되는지 알게 쓰는 것이 목표다.

길드원에게는 할 일이 너무 많아 보이면 안 된다 (제작자 요청 2026-11-02: '너무 과하다'). 꼭 챙길 만한 것만 적게.

넣는 것 (기간이 정해진 것 중 길드원이 직접 하는 일)
- 출석 보상 수령, 이벤트 퀘스트, 이벤트 아이템 모으기와 NPC 교환, 이벤트 제작, 이벤트 던전·보스, 쿠폰 입력, 이벤트 상점, 우편 보상 수령
- 시즌제 일정: 길드 점령전, 이노티아 워 경기처럼 정해진 요일·시각에 열리는 것 (한국어 서버, 한국 시간 기준)
- 참여 보상이 있는 게임 밖 응모 (제작자 요청 2026-11-02 '넣어야지'): 스크린샷·영상 응모, SNS 인증, 설문, 퀴즈, 카카오톡 채널 추가.
  text 는 무엇을 올리는지 (예: "버프 세팅 스샷 응모"), note 는 어디에 올리는지 (예: "공식 디스코드"), 응모 마감을 end 로

넣지 않는 것
- 유료 결제, 패키지·상품·상자 판매와 뽑기, 원스토어 결제 프로모션과 포인트백, 결제 인증
- 확률 안내, 당첨·결과 발표, 보상 지급 안내(받는 사람이 따로 할 일이 없는 것), 오류 수정, 점검, 운영정책, 기능 설명
- 상시 콘텐츠의 기본 안내(인스턴스 던전, 길드 임무, 길드 출석, 길드 던전, 헌팅 그라운드 이용 시간): 앱이 따로 보여 준다
- 길드장이나 특정 직책만 할 수 있는 일 (예: 점령 길드의 마력회수)
- 핫타임, 경험치·드랍 증가 같은 효과 (그 시간에 사냥하면 저절로 받는 것이라 할 일이 아니다)

쓰는 법
- text: 할 일만 명사형으로 아주 짧게 (6~14자, 끝맺는 말 없이). 예: "으스스한장난감 교환", "해골가면 제작", "헌터증서 교환", "11월 출석 보상".
  다른 글에서 뽑은 비슷한 일과 한 화면에 같이 보이므로, 흔한 이름은 이벤트 이름을 앞에 붙여 구분한다 (예: "11월 출석 보상", "또봉이 출석 보상", "김선달 콜라보 퀘스트")
- note: 어디서 하는지 하나만, 12자 안팎 (예: "NPC 빅터", "이벤트 탭", "해변의 전장"). 설명, 조건, 좌표는 쓰지 않는다. 없으면 null
- 한 이벤트의 여러 단계(주차별 퀘스트, 재료 모으기와 교환)는 한 줄로 합친다. 회차마다 기간이 다르면(1회차, 2회차) 회차마다 한 줄
- cycle: daily 는 날마다 초기화되어 매일 다시 받는 것만 (출석 보상, 하루 1회 퀘스트·교환), weekly 는 주마다 초기화되는 것만.
  기간 안에 언제 해도 되는 일(모아서 교환, 퀘스트 끝내기, 도감 채우기)은 once
- days, time: 정해진 요일·시각에만 열리는 것 (예: 화·토 22:30 길드 점령전 → days [2, 6], time "22:30", cycle daily). 요일 번호는 0 일, 1 월 … 6 토. 아니면 [] 와 null
- start, end: 그 일을 할 수 있는 때, "YYYY-MM-DD HH:MM" 한국 시간. 연도는 글 올린 날로 짐작한다.
  '점검 후'는 그날 12:00, '점검 전(까지)'는 그날 10:00, 끝 시각이 없으면 그날 23:59. 시작이 글에 없으면 글 올린 날 00:00. 끝을 모르면 null
- minLevel, maxLevel, jobs: 글에 참여 조건으로 적혀 있을 때만 (예: "Lv.30 이상" → minLevel 30, "마법사 전용" → jobs ["마법사"]). 아니면 null, null, []
- 한 글에서 4줄까지, 꼭 할 만한 것부터. 같은 일을 여러 줄로 나누지 않는다. 한 글 안에 이벤트가 여럿이면 각각 (패치노트 안의 출석 이벤트 등)
- 할 일이 없으면 빈 배열

줄을 누르면 펼쳐지는 요약 (제작자 요청 2026-11-02: '어떤 이벤트인데, 그래서 내가 뭘 하라고?' 를 글을 안 읽어도 알게)
- steps: 게임 안에서 실제로 할 것만 1~3줄, 한 줄 25자 안팎의 '~하기' 없는 명사형. 횟수·주기·장소를 붙인다.
  예 (김선달 이벤트): ["매일 출석", "하루 1회 맵치킨 교환 (NPC 김선달)"]. 예: ["이벤트 몬스터 사냥해 해골가면 모으기", "NPC 빅터에게 해골가면 교환"]
  보상 목록, 교환 목록, 확률, 재료 개수표, 이벤트 소개·인사말은 쓰지 않는다. text 를 그대로 되풀이하지 않는다
- warns: 기간을 몰라서 손해 보는 것만 0~2줄, 날짜·시각과 함께 (한국 시간, '11/19 10:00' 처럼 짧게).
  예: 주차마다 재료가 바뀌면 "2주차 재료(밀가루·고기)는 3주차 시작 11/19 10:00 전에 다 쓰기", 아이템이 사라지면 "이벤트 재료는 11/26 점검 때 사라짐",
  교환 마감이 이벤트 끝보다 빠르면 "교환은 11/30 23:59까지". 그냥 끝나는 날만 되풀이하는 줄(end 와 같은 말)은 쓰지 않는다. 없으면 []
- link: 게임 밖에서 여는 곳이 있으면 그 주소 (응모하는 디스코드 채널·카페 글·설문 폼, 쿠폰 입력 페이지). 글 끝의 '글 속 링크' 에 있는 주소 중 하나를 글자 그대로.
  (제작자 요청 2026-11-02: 원글을 다시 안 봐도 바로 가서 하게). 게임 안에서 하는 일이거나 맞는 링크가 없으면 null.
  steps 에는 올릴 것과 올리는 방법(채널 이름, 필요한 해시태그·양식)을 적는다`;

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
          steps: { type: "array", items: { type: "string" } },
          warns: { type: "array", items: { type: "string" } },
          link: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["text", "note", "cycle", "days", "time", "start", "end", "minLevel", "maxLevel", "jobs", "steps", "warns", "link"],
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
  /** 펼치면 보이는 요약: 게임 안에서 할 것 (1~3줄), 기간을 몰라 손해 보는 것 (0~2줄). #4 전에 정리한 글에는 없다 */
  d?: string[];
  w?: string[];
  /** 모은 할 일(mergeTasks)만: 이 일을 안내한 공식 글 번호들 (새 글 먼저) */
  p?: number[];
  /** 게임 밖에서 여는 곳 (응모하는 디스코드·카페·설문, 쿠폰 입력 페이지). 글 속 링크 중 하나 (#6 부터) */
  l?: string;
}

/** 정리할 글 */
export interface DigestPost {
  id: number;
  kind: string;
  type: string;
  title: string;
  start_date: string | null;
  body: string;
  /** 간단한 HTML (글 속 링크를 읽는다, 58KB 넘는 글은 없다) */
  html?: string | null;
}

/** 글 속 링크 (글자와 주소). 간단한 HTML 의 <a href> 와 본문에 그대로 적힌 주소. 컴투스 공식 글끼리의 링크는 뺀다 */
export function postLinks(post: { body: string; html?: string | null }): { text: string; url: string }[] {
  const out = new Map<string, string>();
  for (const m of String(post.html ?? "").matchAll(/<a href="([^"]+)">([\s\S]*?)<\/a>/g)) {
    const url = m[1].replace(/&amp;/g, "&");
    const text = m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!out.has(url) || !out.get(url)) out.set(url, text);
  }
  for (const m of String(post.body ?? "").matchAll(/https?:\/\/[^\s<>"'）)\]]+/g)) if (!out.has(m[0])) out.set(m[0], "");
  return [...out]
    .filter(([url]) => /^https?:\/\//.test(url) && !/withhive\.com\/(?:help\/)?notice|hive-fn\.qpyou\.cn|com2us\.com\/?$/.test(url))
    .slice(0, 20)
    .map(([url, text]) => ({ url, text }));
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
/** 글자 수를 넘으면 낱말이나 쉼표 사이에서 자른다 (낱말 가운데에서 자르지 않는다, CLAUDE.md '글자와 줄바꿈') */
function short(v: unknown, max: number): string {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const at = Math.max(cut.lastIndexOf(","), cut.lastIndexOf("·"), cut.lastIndexOf("("), cut.lastIndexOf(" "));
  return (at > max / 3 ? cut.slice(0, at) : s.slice(0, max)).replace(/[\s,·(]+$/, "");
}

/** 요약 줄들: 글자만, 겹친 줄 빼고 max 줄까지 */
function lines(v: unknown, max: number, len: number): string[] {
  const out: string[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    const s = short(x, len);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** 모델 답 -> 할 일 목록 (맞지 않는 줄은 버린다). posts: 모은 할 일이면 그 줄이 가리킬 수 있는 글 번호, max: 줄 수 */
export function normalizeTasks(raw: unknown, posts?: Set<number>, max = 6, links?: Set<string>): TodoTask[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { tasks?: unknown }).tasks) ? (raw as { tasks: unknown[] }).tasks : [];
  const out: TodoTask[] = [];
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const t = short(r.text, 24);
    if (!t) continue;
    const p = posts && Array.isArray(r.posts) ? [...new Set(r.posts.filter((id): id is number => Number.isInteger(id) && posts.has(id as number)))].sort((a, b) => b - a) : undefined;
    if (posts && !p?.length) continue;
    const cycle = r.cycle === "daily" ? "d" : r.cycle === "weekly" ? "w" : "o";
    const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
    const at = typeof r.time === "string" && /^\d{1,2}:\d{2}$/.test(r.time.trim()) ? r.time.trim().padStart(5, "0") : null;
    const s = kstTime(r.start);
    let e = kstTime(r.end);
    if (s !== null && e !== null && e <= s) e = null;
    out.push({
      t,
      n: short(r.note, 16) || null,
      // 정해진 요일에 열리는 일은 그날 할 일
      c: days.length ? "d" : cycle,
      days,
      at,
      s,
      e,
      lv: [level(r.minLevel), level(r.maxLevel)],
      jobs: Array.isArray(r.jobs) ? r.jobs.map((j) => JOB_KEY[String(j)]).filter((j): j is string => !!j) : [],
      d: lines(r.steps, 3, 40),
      w: lines(r.warns, 2, 60),
      ...(p ? { p } : {}),
      // 링크는 글에 있던 주소만 (지어낸 주소를 막는다)
      ...(typeof r.link === "string" && links?.has(r.link.trim()) ? { l: r.link.trim() } : {}),
    });
    if (out.length >= max) break;
  }
  return out;
}

/** 할 일이 끝나는 가장 늦은 때 (끝을 모르는 일이 있으면 글 올린 날 + 30일, 할 일이 없으면 0) */
export function tasksUntil(tasks: TodoTask[], postDate: string | null): number {
  if (!tasks.length) return 0;
  const posted = kstTime(postDate) ?? Date.now();
  return Math.max(...tasks.map((t) => t.e ?? Math.max(posted, t.s ?? 0) + 30 * 86_400_000));
}

/**
 * Claude 에 묻고 JSON 을 받는다 (제작자 요청: 품질이 먼저. 답 모양 지정, 안전 필터가 거절하면 서버가 알맞은 다른 모델로 이어서 한다).
 * 이 계정이나 모델이 그 조합을 받지 않으면 거절 이어받기 없이, 그래도 안 되면 답 모양 지정 없이 글에서 JSON 을 꺼낸다.
 * 거절당하면 null, API 오류는 던진다 (나중에 다시)
 */
async function askJson(client: Anthropic, system: string, user: string, schema: object, shape: string): Promise<unknown> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  const format = { type: "json_schema" as const, schema: schema as Record<string, unknown> };
  let res: Anthropic.Beta.BetaMessage | Anthropic.Message;
  try {
    res = await client.beta.messages.create({
      model: DIGEST_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format },
      system,
      messages,
    });
  } catch (e) {
    if (!(e instanceof Anthropic.BadRequestError)) throw e;
    try {
      res = await client.messages.create({ model: DIGEST_MODEL, max_tokens: 16000, output_config: { effort: "high", format }, system, messages });
    } catch (e2) {
      if (!(e2 instanceof Anthropic.BadRequestError)) throw e2;
      res = await client.messages.create({
        model: DIGEST_MODEL,
        max_tokens: 16000,
        output_config: { effort: "high" },
        system: system + `\n\n답은 다른 말 없이 JSON 한 덩어리로만: ${shape}`,
        messages,
      });
    }
  }
  if (res.stop_reason === "refusal") return null;
  if (res.stop_reason === "max_tokens") throw new Error("답이 길어 잘렸어요");
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

const SHAPE = `{"tasks": [{"text", "note", "cycle", "days", "time", "start", "end", "minLevel", "maxLevel", "jobs", "steps", "warns", "link"}]}`;

/** 글 하나를 Claude 에 맡겨 할 일을 뽑는다. 거절당하면 빈 목록, API 오류는 던진다 (나중에 다시) */
export async function digestPost(client: Anthropic, post: DigestPost): Promise<TodoTask[]> {
  const posted = post.start_date ?? "";
  const dow = /^\d{4}-\d{2}-\d{2}$/.test(posted) ? DOW[new Date(posted + "T00:00:00Z").getUTCDay()] : "";
  const user =
    `글 올린 날: ${posted}${dow ? ` (${dow})` : ""}\n종류: ${post.kind === "event" ? "이벤트" : "공지사항"}\n제목: ${post.title}\n\n본문:\n` + post.body.slice(0, 20_000);
  // 글 속 링크 (응모하는 곳, 쿠폰 입력 페이지를 link 로 고르게)
  const links = postLinks(post);
  const linkText = links.length ? "\n\n글 속 링크:\n" + links.map((l) => `- ${l.text ? l.text + ": " : ""}${l.url}`).join("\n") : "";
  const raw = await askJson(client, SYSTEM, user + linkText, TASKS_SCHEMA, SHAPE);
  return raw ? normalizeTasks(raw, undefined, 6, new Set(links.map((l) => l.url))) : [];
}

// ---------- 모으기: 여러 글이 같은 이벤트를 다시 안내해서 겹친 할 일을 하나로 ----------

const MERGE_SYSTEM = `너는 길드 앱 'To do' 의 이벤트 할 일을 마지막으로 정리한다. 아래는 모바일 MMORPG 아이모 공식 글마다 따로 뽑은 할 일이다.
여러 글이 같은 이벤트를 다시 안내해서(이벤트 글, 패치노트, 콜라보 안내) 같은 일이 여러 줄로 겹친다. 한 화면에 그대로 보이므로 깔끔한 목록으로 만든다.
- 같은 이벤트의 같은 일은 한 줄로 합친다. 기간·장소·조건은 가장 정확한 것(구체적인 날짜, 더 짧은 장소 이름)을 남기고, posts 에 합친 줄의 글 번호를 모두 적는다.
- 한 이벤트의 여러 단계는 한 줄로 (예: "김선달 주차 퀘스트", "김선달 콜라보 퀘스트", "또봉이 콜라보 퀘스트" → "김선달 콜라보 퀘스트").
- 다른 일은 합치지 않는다. 이름이 같거나 비슷한데 다른 이벤트면(출석판이 둘 등) 이벤트 이름을 앞에 붙여 구분한다 (예: "11월 출석 보상", "또봉이 출석 보상").
- 길드원에게 너무 많아 보이지 않게 모두 10줄을 넘지 않는다 (제작자 요청 2026-11-02). 받는 보상이 크거나 곧 끝나는 것부터.
- 같은 종류의 짧은 일이 여러 이벤트에 있으면 한 줄로 묶는다 (예: 출석 보상 받기 둘 → text "출석 보상 (11월 · 또봉이)", 기간은 가장 늦게 끝나는 것).
- 핫타임, 경험치·드랍 증가 효과는 할 일이 아니라서 뺀다. 게임 밖 응모(스크린샷·영상, SNS 인증, 설문, 카카오톡 채널)는 할 일로 남긴다.
- 끝난 일(end 가 지금보다 앞)은 뺀다. 없던 일을 새로 만들지 않는다. 회차마다 기간이 다른 줄(1회차, 2회차)은 합치지 않고,
  같은 이벤트를 전체 기간 한 줄로도 적은 줄이 있으면 그 줄은 빼고 회차 줄만 남긴다 (기간이 겹쳐 두 번 보이지 않게).
- text 는 6~14자 명사형, note 는 어디서 하는지 하나만 12자 안팎. 나머지 칸(cycle, days, time, start, end, minLevel, maxLevel, jobs)은 받은 값의 뜻을 그대로 둔다.
- link(게임 밖에서 여는 곳의 주소)는 합친 줄 중 하나의 값을 글자 그대로 둔다 (새로 만들지 않는다, 없으면 null).
- steps(게임 안에서 할 것 1~3줄)와 warns(기간을 몰라서 손해 보는 것 0~2줄, 날짜와 함께)는 합친 줄들의 것을 모아 겹친 말을 빼고 남긴다.
  묶은 줄이면 이벤트마다 무엇을 하는지 짧게 (예: ["11월 출석판 매일 출석", "또봉이 출석판 매일 출석"]). 보상·교환 목록은 쓰지 않는다. 받은 줄에 없던 내용을 새로 만들지 않는다.`;

const MERGE_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        ...TASKS_SCHEMA.properties.tasks.items,
        properties: { ...TASKS_SCHEMA.properties.tasks.items.properties, posts: { type: "array", items: { type: "integer" } } },
        required: [...TASKS_SCHEMA.properties.tasks.items.required, "posts"],
      },
    },
  },
  required: ["tasks"],
  additionalProperties: false,
};

/** 글 하나에서 뽑아 둔 할 일 */
export interface DigestOfPost {
  id: number;
  title: string;
  start_date: string | null;
  /** 정리한 때 (모은 목록이 이 정리들로 만든 것인지 알아보는 표시) */
  made_at: number;
  tasks: TodoTask[];
}

/** 모으는 지시문의 판: 고치면 올린다 (글마다 다시 정리하지 않고 모으기만 다시 한다) */
const MERGE_VERSION = 6;

/** 모은 목록이 어느 정리들로 만든 것인지 (모으기 판, 글 번호와 정리한 때). 같으면 다시 모으지 않는다 */
export function mergeSignature(digests: DigestOfPost[], now = Date.now()): string {
  const live = digests.filter((d) => d.tasks.some((t) => t.e === null || t.e > now)).map((d) => [d.id, d.made_at]);
  return JSON.stringify([MERGE_VERSION, ...live.sort((a, b) => a[0] - b[0])]);
}

/** mergeSignature 에서 [글 번호, 정리한 때] 들 (예전 모양 [[id, made_at], …] 도 읽는다) */
export function signatureSources(sig: string): [number, number][] {
  try {
    const v = JSON.parse(sig) as unknown[];
    return v.filter((x): x is [number, number] => Array.isArray(x) && x.length === 2);
  } catch {
    return [];
  }
}

const JOB_KO_OF: Record<string, string> = { warrior: "전사", ranger: "레인저", mage: "마법사", monk: "무도가" };
const kstText = (ms: number | null) => (ms === null ? null : new Date(ms + 9 * 3_600_000).toISOString().slice(0, 16).replace("T", " "));

/** 지금 할 수 있는 할 일을 모두 모아 겹친 것을 합친다 (10줄까지). 할 일이 없으면 빈 목록, 거절당하면 null (그때는 글마다 뽑은 그대로 보인다) */
export async function mergeTasks(client: Anthropic, digests: DigestOfPost[], now = Date.now()): Promise<TodoTask[] | null> {
  const live = digests.map((d) => ({ ...d, tasks: d.tasks.filter((t) => t.e === null || t.e > now) })).filter((d) => d.tasks.length);
  if (!live.length) return [];
  const blocks = live.map(
    (d) =>
      `#${d.id} (${d.start_date ?? ""}) ${d.title}\n` +
      d.tasks
        .map((t) =>
          JSON.stringify({
            text: t.t, note: t.n, cycle: t.c === "d" ? "daily" : t.c === "w" ? "weekly" : "once", days: t.days, time: t.at,
            start: kstText(t.s), end: kstText(t.e), minLevel: t.lv[0], maxLevel: t.lv[1], jobs: t.jobs.map((j) => JOB_KO_OF[j] ?? j),
            steps: t.d ?? [], warns: t.w ?? [], link: t.l ?? null,
          }),
        )
        .join("\n"),
  );
  const raw = await askJson(
    client,
    MERGE_SYSTEM,
    `지금: ${kstText(now)} (한국 시간)\n\n${blocks.join("\n\n")}`,
    MERGE_SCHEMA,
    SHAPE.replace('"link"}', '"link", "posts"}'),
  );
  const links = new Set(live.flatMap((d) => d.tasks.flatMap((t) => (t.l ? [t.l] : []))));
  return raw ? normalizeTasks(raw, new Set(live.map((d) => d.id)), 10, links) : null;
}

/** 정리할 글인지 (제목만 봐도 할 일이 없는 글은 모델에 보내지 않는다) */
export const NO_TODO_TITLE = /결과\s*발표|당첨자\s*(발표|안내)|지급\s*(안내|완료)|사전\s*예고|개인정보|운영\s*정책/;

/** 클라이언트 (워크스페이스에 묶이지 않은 키는 워크스페이스를 헤더로 알린다, functions/api/chat 과 같다) */
export function digestClient(apiKey: string, workspace?: string | null): Anthropic {
  const ws = workspace?.trim();
  return new Anthropic({ apiKey, maxRetries: 3, ...(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {}) });
}
