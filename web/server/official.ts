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
  /점검|패치|업데이트|공지|이벤트|쿠폰|공홈|공식|출시|신규|보상|장애|오류|버그|임시|정기|콜라보|프로모션|포인트백|원스토어|시즌|오픈|컴투스|운영정책|신캐|신직업|코스튬|패키지|상자|소식|뉴스|교환|재료|퀘스트|NPC|npc|사용처|용도/;
/** 제목 찾기에 쓰지 않는 묻는 말 */
const ASK_WORD = /^(언제|어디|뭐|무엇|무슨|어떤|어떻게|알려|알려줘|있어|있나|있냐|했어|해요|인가|이번|다음|지금|오늘|내일|최근|요즘|공식|공지|소식|정보|내용|관련|아이모|사용처|용도|쓰임|쓰는|쓰나|써요|써야|어디다|어디서|어디에|주나|주는|받나|받는|얻나|얻는|구하|모으|모아)/;

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
 * 챗봇에 붙일 공식 소식: 최근 글 목록과, 질문에 맞는 글 3개까지의 본문.
 * 점검을 물으면 가장 최근 점검 글, 패치를 물으면 가장 최근 패치노트, 그 밖에는 제목에 질문 낱말이 많이 든 글.
 * 2026-11-03 (제작자: '밀가루 사용처 대답 왜 못해, 이벤트 있는데'): 질문에 점검·이벤트 같은 말이 없어도 질문의 낱말(밀가루, 주모 …)이 최근 글 **본문**에
 * 나오면 그 글을 붙이고, 본문은 자르지 않고 전부 준다 (제작자 '3500자 한도 이딴 거 하지 마, 무조건 다 봐').
 * 진행 중인 이벤트(끝나는 날이 안 지난 것)를 먼저, 그다음 새 글.
 */
export async function officialContext(env: Env, question: string): Promise<string> {
  const words = [
    ...new Set(
      question
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 2 && !ASK_WORD.test(w))
        .map((w) => w.replace(/(은|는|이|가|을|를|에|의|도|로|으로|에서|에게|한테|께|부터|까지|처럼|보다|이나|이랑|랑|하고|만|요|야|좀)$/, ""))
        .filter((w) => w.length >= 2 && !ASK_WORD.test(w)),
    ),
  ].slice(0, 6);
  const asked = OFFICIAL_ASK.test(question);
  if (!asked && !words.length) return "";
  const { results } = await env.DB.prepare(
    "SELECT id, kind, type, title, start_date, end_date FROM official_news ORDER BY id DESC LIMIT 80",
  ).all<Row>();
  if (!results.length) return "";
  // 질문 낱말이 본문에 나오는 글 (글마다 처음 나온 자리): 최근 80개 안에서만, 낱말 6개까지
  const inBody = new Map<number, { word: string; pos: number; n: number }>();
  if (words.length) {
    const cols = words.map((_, i) => `instr(body, ?${i + 2}) AS p${i}`).join(", ");
    const cond = words.map((_, i) => `instr(body, ?${i + 2}) > 0`).join(" OR ");
    const rows = await env.DB.prepare(`SELECT id, ${cols} FROM official_news WHERE id >= ?1 AND (${cond})`)
      .bind(results[results.length - 1].id, ...words)
      .all<Record<string, number>>();
    for (const r of rows.results) {
      let best: { word: string; pos: number } | null = null;
      let n = 0;
      words.forEach((w, i) => {
        const p = r[`p${i}`];
        if (p > 0) {
          n++;
          if (!best || p < best.pos) best = { word: w, pos: p };
        }
      });
      if (best) inBody.set(r.id, { ...best, n });
    }
  }
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const ongoing = (r: Row) => r.kind === "event" && (!r.end_date || r.end_date.slice(0, 10) >= today);
  const picks: Row[] = [];
  const add = (r: Row | undefined) => r && !picks.includes(r) && picks.length < 3 && picks.push(r);
  if (/점검/.test(question)) add(results.find((r) => r.type === "C"));
  if (/패치|업데이트/.test(question)) add(results.find((r) => /패치노트/.test(r.title)));
  // 점수: 제목에 든 낱말 x3 + 본문에 든 낱말, 진행 중인 이벤트 +2. 같으면 새 글
  const scored = results
    .map((r) => ({ r, n: words.filter((w) => r.title.includes(w)).length * 3 + (inBody.get(r.id)?.n ?? 0) + (inBody.has(r.id) && ongoing(r) ? 2 : 0) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || b.r.id - a.r.id);
  for (const x of scored) add(x.r);
  if (!picks.length && /이벤트|쿠폰|보상|프로모션|콜라보/.test(question)) add(results.find((r) => r.kind === "event"));
  if (!asked && !picks.length) return "";

  // 본문은 자르지 않고 전부 준다 (제작자 2026-11-03 '3500자 한도 이딴 거 하지 마, 무조건 다 봐'. 전에는 처음 3500자만 줘서 글 깊숙한 교환 안내를 못 봤다)
  const bodies = picks.length
    ? (await env.DB.prepare(`SELECT id, body FROM official_news WHERE id IN (${picks.map(() => "?").join(",")})`).bind(...picks.map((p) => p.id)).all<{ id: number; body: string }>())
        .results.map((b) => [b.id, b.body] as const)
    : [];
  const bodyOf = new Map(bodies);
  const list = results
    .slice(0, 30)
    .map((r) => `#${r.id} [${TYPE_NAME[r.type] ?? r.type}] ${r.title} · ${dates(r)} · ${officialUrl(r.kind, r.id)}`);
  const parts = [`[컴투스 공식 소식: 최근 글 30개 (새 것 먼저, withhive.com 아이모 공지사항·이벤트)]\n${list.join("\n")}`];
  for (const p of picks) {
    const body = bodyOf.get(p.id);
    if (body) parts.push(`[공식 글 본문: ${p.title} (${TYPE_NAME[p.type] ?? p.type}, ${dates(p)}, ${officialUrl(p.kind, p.id)}${ongoing(p) ? ", 진행 중" : ""})]\n${body}`);
  }
  return parts.join("\n\n");
}

/** 점검 글을 새로 받는 간격 (2분), 새 이벤트 글을 찾는 간격 (15분) */
export const MAINT_EVERY = 120_000;
export const EVENT_EVERY = 15 * 60_000;

/** setup 의 key 를 지난번 때(lastAt)일 때만 지금으로 바꿔 맡는다 (여럿이 같이 와도 하나만). 맡았으면 true */
async function claim(env: Env, key: string, lastAt: number | null, now: number): Promise<boolean> {
  const r =
    lastAt === null
      ? await env.DB.prepare("INSERT OR IGNORE INTO setup (key, done_at) VALUES (?, ?)").bind(key, now).run()
      : await env.DB.prepare("UPDATE setup SET done_at = ? WHERE key = ? AND done_at = ?").bind(now, key, lastAt).run();
  return !!r.meta.changes;
}

/** withhive 목록 첫 쪽 (type: C 점검, E 이벤트) */
async function hiveList(type: "C" | "E", rows: number): Promise<HiveItem[]> {
  const res = await fetch("https://withhive.com/api/notice/list/32", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      accept: "application/json",
      cookie: "language=ko",
    },
    body: `page=1&type=${type}&rows=${rows}`,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const list = ((await res.json()) as { data?: { notice_list?: HiveItem[] } }).data?.notice_list ?? [];
  return list.filter((i) => Number(i?.noticeId) > 0 && i.noticeTitle);
}

/**
 * 점검 글(종류 C) 최근 3개를 새로 받는다 (점검 전광판: 새 점검, 연장, 종료가 몇 분 안에 보이게. 제작자 요청 2026-11-01).
 * /api/news 가 2분에 한 번 뒤에서 부른다 (lastAt: 지난번 때, 그 값일 때만 맡아 여럿이 같이 와도 한 번). 받는 글은 30KB 쯤이고
 * 원문이 그대로면 바꾸지 않아 무료 요금제 CPU 한도(10ms) 안에 든다. 이벤트·공지는 크고(글 하나 400KB 도 있다) GitHub Actions 가 받는다
 */
export async function refreshMaint(env: Env, lastAt: number | null, now = Date.now()): Promise<void> {
  if (!(await claim(env, "official_maint_checked", lastAt, now))) return;
  const items = await hiveList("C", 3);
  if (!items.length) return;
  const ids = items.map((i) => Number(i.noticeId));
  const { results } = await env.DB.prepare(`SELECT id, src FROM official_news WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .bind(...ids)
    .all<{ id: number; src: string | null }>();
  const known = new Map(results.map((r) => [r.id, r.src]));
  const changed = items.filter((i) => known.get(Number(i.noticeId)) !== srcOf(i));
  if (changed.length) await env.DB.batch(changed.map((i) => env.DB.prepare(UPSERT_SQL).bind(...upsertValues(rowOf(i, "notice"), now))));
}

/**
 * 새 이벤트 글을 찾아 넣는다 (15분에 한 번, To do 의 이벤트 할 일이 GitHub 예약 작업을 기다리지 않게). 처음 보는 글만 넣고 이미 있는 글은 건드리지 않는다:
 * 이벤트 글은 본문에 그림이 통째로 들어 있어 크고(400KB 도 있다) 무료 요금제 CPU 한도(10ms)에 걸릴 수 있어서, 고친 글은 GitHub Actions·배포가 받는다.
 * 본문 글자와 HTML 은 그림 자료(data:)를 뺀 본문으로 만든다 (어차피 둘 다 그림 자료를 버려서 결과가 같다). 원문 표시(src)는 받는 스크립트와 같게 전체로
 */
export async function refreshEvents(env: Env, lastAt: number | null, now = Date.now()): Promise<void> {
  if (!(await claim(env, "official_event_checked", lastAt, now))) return;
  const items = await hiveList("E", 3);
  if (!items.length) return;
  const ids = items.map((i) => Number(i.noticeId));
  const { results } = await env.DB.prepare(`SELECT id FROM official_news WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .bind(...ids)
    .all<{ id: number }>();
  const known = new Set(results.map((r) => r.id));
  const fresh = items.filter((i) => !known.has(Number(i.noticeId)));
  if (!fresh.length) return;
  await env.DB.batch(
    fresh.map((i) => {
      const light = String(i.content ?? "").replace(/(<img[^>]*?\ssrc\s*=\s*["'])data:[^"']*/gi, "$1");
      return env.DB.prepare(UPSERT_SQL).bind(...upsertValues({ ...rowOf({ ...i, content: light }, "event"), src: srcOf(i) }, now));
    }),
  );
}
