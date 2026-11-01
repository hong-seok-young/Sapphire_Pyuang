// 컴투스 공식 소식 (제작자 요청 2026-11-01): withhive.com 아이모 공지사항·점검·이벤트를 D1 official_news 에 받아 둔 것
// (scripts/fetch-official.mjs, 30분마다). 화면 목록(functions/api/official.ts)과 챗봇 자료(functions/api/chat)가 쓴다.
// 공식 홈페이지의 공개 글을 읽을 뿐 게임은 읽지 않는다 (CLAUDE.md 게임 안전 규칙).
import type { Env } from "./auth";
import { UPSERT_SQL, rowOf, srcOf, upsertValues } from "./officialText";
import type { HiveItem } from "./officialText";

export type OfficialType = "N" | "C" | "I" | "D" | "E";
export const TYPE_NAME: Record<string, string> = { N: "공지사항", C: "점검", I: "안내", D: "오류", E: "이벤트" };

/** 공식 페이지 주소 */
export const officialUrl = (kind: string, id: number) => `https://withhive.com/${kind === "event" ? "event" : "notice"}/32/${id}`;

/** 이런 말이 있으면 챗봇에 공식 소식을 붙인다 */
export const OFFICIAL_ASK =
  /점검|패치|업데이트|공지|이벤트|쿠폰|공홈|공식|출시|신규|보상|장애|오류|버그|임시|정기|콜라보|프로모션|포인트백|원스토어|시즌|오픈|컴투스|운영정책|신캐|신직업|코스튬|패키지|상자/;
/** 제목 찾기에 쓰지 않는 묻는 말 */
const ASK_WORD = /^(언제|어디|뭐|무엇|무슨|어떤|어떻게|알려|알려줘|있어|있나|있냐|했어|해요|인가|이번|다음|지금|오늘|내일|최근|요즘|공식|공지|소식|정보|내용|관련|아이모)/;

interface Row {
  id: number;
  kind: string;
  type: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
}

const dates = (r: Row) => (r.start_date ?? "") + (r.end_date ? ` ~ ${r.end_date}` : "");

/**
 * 챗봇에 붙일 공식 소식 (질문이 점검, 패치, 이벤트 같은 것을 물을 때만): 최근 글 목록과, 질문에 맞는 글 3개까지의 본문.
 * 점검을 물으면 가장 최근 점검 글, 패치를 물으면 가장 최근 패치노트, 그 밖에는 제목에 질문 낱말이 많이 든 글
 */
export async function officialContext(env: Env, question: string): Promise<string> {
  if (!OFFICIAL_ASK.test(question)) return "";
  const { results } = await env.DB.prepare(
    "SELECT id, kind, type, title, start_date, end_date FROM official_news ORDER BY id DESC LIMIT 80",
  ).all<Row>();
  if (!results.length) return "";
  const words = question
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !ASK_WORD.test(w))
    .map((w) => w.replace(/(은|는|이|가|을|를|에|의|도|로|으로|에서|이랑|랑|하고|요|야|좀)$/, ""))
    .filter((w) => w.length >= 2);
  const picks: Row[] = [];
  const add = (r: Row | undefined) => r && !picks.includes(r) && picks.length < 3 && picks.push(r);
  if (/점검/.test(question)) add(results.find((r) => r.type === "C"));
  if (/패치|업데이트/.test(question)) add(results.find((r) => /패치노트/.test(r.title)));
  const scored = results
    .map((r) => ({ r, n: words.filter((w) => r.title.includes(w)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || b.r.id - a.r.id);
  for (const x of scored) add(x.r);
  if (!picks.length && /이벤트|쿠폰|보상|프로모션|콜라보/.test(question)) add(results.find((r) => r.kind === "event"));

  const bodies = picks.length
    ? (
        await env.DB.prepare(`SELECT id, substr(body, 1, 3500) AS body FROM official_news WHERE id IN (${picks.map(() => "?").join(",")})`)
          .bind(...picks.map((p) => p.id))
          .all<{ id: number; body: string }>()
      ).results
    : [];
  const bodyOf = new Map(bodies.map((b) => [b.id, b.body]));
  const list = results
    .slice(0, 30)
    .map((r) => `#${r.id} [${TYPE_NAME[r.type] ?? r.type}] ${r.title} · ${dates(r)} · ${officialUrl(r.kind, r.id)}`);
  const parts = [`[컴투스 공식 소식: 최근 글 30개 (새 것 먼저, withhive.com 아이모 공지사항·이벤트)]\n${list.join("\n")}`];
  for (const p of picks) {
    const body = bodyOf.get(p.id);
    if (body) parts.push(`[공식 글 본문: ${p.title} (${TYPE_NAME[p.type] ?? p.type}, ${dates(p)}, ${officialUrl(p.kind, p.id)})]\n${body}`);
  }
  return parts.join("\n\n");
}

/** 점검 글을 새로 받는 간격 (2분) */
export const MAINT_EVERY = 120_000;

/**
 * 점검 글(종류 C) 최근 3개를 새로 받는다 (점검 전광판: 새 점검, 연장, 종료가 몇 분 안에 보이게. 제작자 요청 2026-11-01).
 * /api/news 가 2분에 한 번 뒤에서 부른다 (lastAt: 지난번 때, 그 값일 때만 맡아 여럿이 같이 와도 한 번). 받는 글은 30KB 쯤이고
 * 원문이 그대로면 바꾸지 않아 무료 요금제 CPU 한도(10ms) 안에 든다. 이벤트·공지는 크고(글 하나 400KB 도 있다) GitHub Actions 가 받는다
 */
export async function refreshMaint(env: Env, lastAt: number | null, now = Date.now()): Promise<void> {
  const claim =
    lastAt === null
      ? await env.DB.prepare("INSERT OR IGNORE INTO setup (key, done_at) VALUES ('official_maint_checked', ?)").bind(now).run()
      : await env.DB.prepare("UPDATE setup SET done_at = ? WHERE key = 'official_maint_checked' AND done_at = ?").bind(now, lastAt).run();
  if (!claim.meta.changes) return;
  const res = await fetch("https://withhive.com/api/notice/list/32", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      accept: "application/json",
      cookie: "language=ko",
    },
    body: "page=1&type=C&rows=3",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return;
  const list = ((await res.json()) as { data?: { notice_list?: HiveItem[] } }).data?.notice_list ?? [];
  const items = list.filter((i) => Number(i?.noticeId) > 0 && i.noticeTitle);
  if (!items.length) return;
  const ids = items.map((i) => Number(i.noticeId));
  const { results } = await env.DB.prepare(`SELECT id, src FROM official_news WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .bind(...ids)
    .all<{ id: number; src: string | null }>();
  const known = new Map(results.map((r) => [r.id, r.src]));
  const changed = items.filter((i) => known.get(Number(i.noticeId)) !== srcOf(i));
  if (changed.length) await env.DB.batch(changed.map((i) => env.DB.prepare(UPSERT_SQL).bind(...upsertValues(rowOf(i, "notice"), now))));
}

