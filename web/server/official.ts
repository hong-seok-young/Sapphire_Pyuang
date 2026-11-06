// 컴투스 공식 소식 (제작자 요청 2026-11-01): withhive.com 아이모 공지사항·점검·이벤트를 D1 official_news 에 받아 둔 것
// (scripts/fetch-official.mjs, 30분마다). 화면 목록(functions/api/official.ts)과 챗봇 자료(functions/api/chat)가 쓴다.
// 공식 홈페이지의 공개 글을 읽을 뿐 게임은 읽지 않는다 (CLAUDE.md 게임 안전 규칙).
import type { Env } from "./auth";
import { slangOf, withImages } from "./officialImages";
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

/** 제목 견주기: 꺾쇠·괄호 속 말과 글자 아닌 것을 빼고 두 글자씩 */
const bigrams = (t: string) => {
  const s = t.replace(/<[^>]*>|\([^)]*\)|\[[^\]]*\]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
  return new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
};
/** 같은 이벤트를 다시 안내한 글 (용사의 유물 시즌 2 를 몇 달마다 다시 연다): 제목이 반 넘게 같으면 */
function sameEvent(a: string, b: string): boolean {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.size || !y.size) return false;
  let both = 0;
  for (const g of x) if (y.has(g)) both++;
  return both / (x.size + y.size - both) >= 0.5;
}

/**
 * 챗봇에 붙일 공식 소식: 최근 글 목록과, 질문에 맞는 글 3개까지의 본문.
 * 점검을 물으면 가장 최근 점검 글, 패치를 물으면 가장 최근 패치노트, 그 밖에는 제목에 질문 낱말이 많이 든 글.
 * 2026-11-03 (제작자: '밀가루 사용처 대답 왜 못해, 이벤트 있는데'): 질문에 점검·이벤트 같은 말이 없어도 질문의 낱말(밀가루, 주모 …)이 글 **본문**에
 * 나오면 그 글을 붙이고, 본문은 자르지 않고 전부 준다 (제작자 '3500자 한도 이딴 거 하지 마, 무조건 다 봐').
 * 2026-11-06 (제작자: 유물깡 교환표는 그림에만 있다, '이벤트에 있는 모든 데이터 이미지 포함해서 싹 다 데이터화'): 본문은 그림 속 표·글자를 옮긴 것까지
 * (official_rich + official_img, server/officialImages.ts), 낱말은 그림 글자에서도 찾고, 몇 달마다 다시 여는 이벤트를 찾게 모든 글에서 찾는다.
 * 같은 이벤트의 예전 안내는 가장 새 글 하나만. 게임 은어(유물깡)는 공식 글의 말로 바꿔 찾는다 (SLANG).
 * 진행 중인 이벤트(끝나는 날이 안 지난 것)를 먼저, 그다음 새 글.
 */
export async function officialContext(env: Env, question: string): Promise<string> {
  const toWords = (q: string) =>
    q
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 2 && !ASK_WORD.test(w))
      .map((w) => w.replace(/(은|는|이|가|을|를|에|의|도|로|으로|에서|에게|한테|께|부터|까지|처럼|보다|이나|이랑|랑|하고|만|요|야|좀)$/, ""))
      .filter((w) => w.length >= 2 && !ASK_WORD.test(w));
  const slang = slangOf(question);
  const words = [...new Set([...toWords(question).slice(0, 6), ...toWords(slang)])].slice(0, 12);
  const asked = OFFICIAL_ASK.test(question) || !!slang;
  if (!asked && !words.length) return "";
  const { results } = await env.DB.prepare("SELECT id, kind, type, title, start_date, end_date FROM official_news ORDER BY id DESC").all<Row>();
  if (!results.length) return "";
  const recent = new Set(results.slice(0, 80).map((r) => r.id));
  // 질문 낱말이 본문이나 그림 글자에 나오는 글 (낱말 12개까지). 그림 글자는 한 번만 훑어서 글로 모은다 (D1 무료 한도: 읽는 줄 수를 적게)
  const inBody = new Map<number, number>();
  if (words.length) {
    const hit = (col: string) => words.map((_, i) => `(instr(${col}, ?${i + 1}) > 0)`);
    const rows = await env.DB.prepare(
      `WITH g AS (SELECT key, ${hit("text").map((h, i) => `${h} AS g${i}`).join(", ")} FROM official_img WHERE text != '' AND (${hit("text").join(" OR ")})), ` +
        `gi AS (SELECT r.id, ${words.map((_, i) => `MAX(g.g${i}) AS g${i}`).join(", ")} FROM official_rich r, json_each(r.keys) k JOIN g ON g.key = k.value GROUP BY r.id) ` +
        `SELECT n.id, ${hit("COALESCE(r.text, n.body)").map((h, i) => `(${h} OR COALESCE(gi.g${i}, 0)) AS h${i}`).join(", ")} ` +
        `FROM official_news n LEFT JOIN official_rich r ON r.id = n.id LEFT JOIN gi ON gi.id = n.id WHERE ${words.map((_, i) => `h${i}`).join(" OR ")}`,
    )
      .bind(...words)
      .all<Record<string, number>>();
    for (const r of rows.results) inBody.set(r.id, words.filter((_, i) => r[`h${i}`]).length);
  }
  // 진행 중인지: 공식 목록에는 이벤트 끝나는 날이 비어 있어서, To do 정리(official_todo)가 글에서 읽은 끝나는 때를 쓴다. 정리 전이면 올린 지 3주 안
  const untilOf = new Map(
    (await env.DB.prepare("SELECT id, until FROM official_todo WHERE id > 0").all<{ id: number; until: number }>()).results.map((t) => [t.id, t.until]),
  );
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const threeWeeks = new Date(Date.now() + 9 * 3_600_000 - 21 * 86_400_000).toISOString().slice(0, 10);
  const ongoing = (r: Row) =>
    r.kind === "event" &&
    (r.end_date ? r.end_date.slice(0, 10) >= today : untilOf.has(r.id) ? (untilOf.get(r.id) ?? 0) > Date.now() : (r.start_date ?? "") >= threeWeeks);
  const picks: Row[] = [];
  const add = (r: Row | undefined) => r && !picks.some((p) => p === r || sameEvent(p.title, r.title)) && picks.length < 3 && picks.push(r);
  if (/점검/.test(question)) add(results.find((r) => r.type === "C"));
  if (/패치|업데이트/.test(question)) add(results.find((r) => /패치노트/.test(r.title)));
  // 점수: 제목에 든 낱말 x3 + 본문·그림에 든 낱말, 진행 중인 이벤트 +2, 최근 80개 +1. 같으면 새 글
  const scored = results
    .map((r) => {
      const title = words.filter((w) => r.title.includes(w)).length * 3;
      const body = inBody.get(r.id) ?? 0;
      return { r, n: title + body + (title + body && ongoing(r) ? 2 : 0) + (title + body && recent.has(r.id) ? 1 : 0) };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || b.r.id - a.r.id);
  for (const x of scored) add(x.r);
  if (!picks.length && /이벤트|쿠폰|보상|프로모션|콜라보/.test(question)) add(results.find((r) => r.kind === "event"));
  if (!asked && !picks.length) return "";

  // 본문은 자르지 않고 전부, 그림 속 표·글자를 그 자리에 넣어서 준다
  const bodyOf = new Map<number, string>();
  if (picks.length) {
    const rows = (
      await env.DB.prepare(
        `SELECT n.id, n.body, r.text AS rich, r.keys FROM official_news n LEFT JOIN official_rich r ON r.id = n.id WHERE n.id IN (${picks.map(() => "?").join(",")})`,
      )
        .bind(...picks.map((p) => p.id))
        .all<{ id: number; body: string; rich: string | null; keys: string | null }>()
    ).results;
    const keysOf = new Map(rows.map((r) => [r.id, r.rich ? (JSON.parse(r.keys || "[]") as string[]) : []]));
    const all = [...new Set([...keysOf.values()].flat())];
    const texts = new Map<string, string>();
    if (all.length) {
      const imgs = await env.DB.prepare("SELECT key, text FROM official_img WHERE key IN (SELECT value FROM json_each(?1)) AND text != ''")
        .bind(JSON.stringify(all))
        .all<{ key: string; text: string }>();
      for (const g of imgs.results) texts.set(g.key, g.text);
    }
    for (const r of rows) bodyOf.set(r.id, r.rich ? withImages(r.rich, keysOf.get(r.id) ?? [], texts) : r.body);
  }
  const list = results
    .slice(0, 30)
    .map((r) => `#${r.id} [${TYPE_NAME[r.type] ?? r.type}] ${r.title} · ${dates(r)} · ${officialUrl(r.kind, r.id)}`);
  const parts = [`[컴투스 공식 소식: 최근 글 30개 (새 것 먼저, withhive.com 아이모 공지사항·이벤트)]\n${list.join("\n")}`];
  for (const p of picks) {
    const body = bodyOf.get(p.id);
    if (!body) continue;
    const again = p.kind === "event" ? results.filter((r) => r !== p && r.kind === "event" && sameEvent(r.title, p.title)).map((r) => dates(r)).slice(0, 8) : [];
    parts.push(
      `[공식 글 본문 (그림 속 표·글자 포함): ${p.title} (${TYPE_NAME[p.type] ?? p.type}, ${dates(p)}, ${officialUrl(p.kind, p.id)}${ongoing(p) ? ", 진행 중" : ""})` +
        (again.length ? ` · 같은 이벤트의 예전 회차: ${again.join(", ")}` : "") +
        `]\n${body}`,
    );
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
