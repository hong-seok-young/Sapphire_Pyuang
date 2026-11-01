// 컴투스 공식 소식 (제작자 요청 2026-11-01): withhive.com 아이모 공지사항·점검·이벤트를 D1 official_news 에 받아 둔 것
// (scripts/fetch-official.mjs, 30분마다). 화면 목록(functions/api/official.ts)과 챗봇 자료(functions/api/chat)가 쓴다.
// 공식 홈페이지의 공개 글을 읽을 뿐 게임은 읽지 않는다 (CLAUDE.md 게임 안전 규칙).
import type { Env } from "./auth";

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
