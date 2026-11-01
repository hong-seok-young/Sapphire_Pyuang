// 아이모 점검 전광판 (제작자 요청 2026-11-01): 공식 점검 글(official_news, 종류 C)에서 점검 시간을 읽는다.
// 홈 '사파이어 길드 포탈' 아래에 '언제부터 언제 점검'을 글씨가 흐르는 띠로 점검이 끝날 때까지 보인다 (/api/news 의 maint).
// 공식 글은 연장되면 같은 글을 고쳐 제목에 '(연장)'을 달고 처음 시간을 줄 긋는다 (줄 그은 시간은 본문 글자에서 이미 뺐다,
// server/officialText.ts markStruck). 끝나면 임시 점검은 제목에 '(종료)'를 단다. 서버가 2분마다 점검 글을 새로 받는다 (server/official.ts).
// 공식 홈페이지의 공개 글을 읽을 뿐 게임은 읽지 않는다 (CLAUDE.md 게임 안전 규칙).

/** 화면에 보낼 점검 하나 */
export interface MaintInfo {
  /** 공식 글 번호 (누르면 앱 안에서 읽는다, #/official/번호) */
  id: number;
  /** '정기 점검', '임시 점검', '긴급 점검', '점검' */
  label: string;
  /** 시작 (ms) */
  start: number;
  /** 끝 (ms). '종료 시까지'처럼 모르면 null */
  end: number | null;
  /** 일부 서버만이면 그 서버 (예: '시리온 서버'), 전 서버면 null */
  servers: string | null;
  /** 제목에 '연장' */
  extended: boolean;
  /** 인스턴스 던전 입장 제한이 시작되는 때 (정기 점검 글의 '인스턴스 던전 제한시간') */
  dungeonFrom: number | null;
}

const HOUR = 3_600_000;
/** 한국 시간 y-m-d h:mi -> ms (시간이 24를 넘으면 다음 날) */
const kst = (y: number, m: number, d: number, h: number, mi: number) => Date.UTC(y, m - 1, d, h - 9, mi);

/** '오후 3시 30분', '15:30', '9:00', '24:30', '11:00 PM' -> [시, 분] */
function clock(ampm: string | undefined, h: string, mi: string | undefined, suffix?: string): [number, number] {
  let hour = Number(h);
  const pm = ampm === "오후" || /pm/i.test(suffix ?? "");
  const am = ampm === "오전" || /am/i.test(suffix ?? "");
  if (pm && hour < 12) hour += 12;
  if (am && hour === 12) hour = 0;
  return [hour, Number(mi ?? 0)];
}

/** 날짜와 시각 (이름표 앞에 s 시작, e 끝을 붙인다) */
const date = (p: string) => String.raw`(?:(?<${p}m>\d{1,2})\s*월\s*(?<${p}d>\d{1,2})\s*일|(?<${p}m2>\d{1,2})\s*\/\s*(?<${p}d2>\d{1,2}))\s*(?:\([^)]{1,3}\))?`;
const time = (p: string) =>
  String.raw`(?:(?<${p}ap>오전|오후)\s*)?(?<${p}h>\d{1,2})\s*(?::\s*(?<${p}mi>\d{2})|시(?:\s*(?<${p}mi2>\d{1,2})\s*분)?)(?:\s*(?<${p}sfx>[AaPp][Mm]))?`;
/** '10월 29일(목) 10:30 ~ 15:00', '10/25(일) 9:00 ~ 11월 26일 02:00', '3월 5일(목) 11:00 PM ~ 3월 6일(금) 12:00 AM', '06:00 ~ 종료 시' */
const RANGE = new RegExp(
  String.raw`${date("s")}\s*${time("s")}\s*(?:\(KST\))?\s*[~∼～\-–]\s*(?:${date("e")}\s*)?(?:${time("e")}(?<tail>(?:\s*\d{1,2}:\d{2})*)|(?<open>종료|완료|별도|추후))`,
);
/** '09:29 ~ 15:00' (인스턴스 던전 제한시간) */
const ONLY_TIME = new RegExp(String.raw`${time("a")}\s*[~∼～\-–]\s*${time("b")}`);

/** 글 올린 날(start_date)의 연도로 점검 날짜의 연도를 정한다 (12월 글의 1월 점검은 다음 해) */
function yearFor(postDate: string | null, month: number): number {
  const m = /^(\d{4})-(\d{2})/.exec(postDate ?? "");
  if (!m) return new Date(Date.now() + 9 * HOUR).getUTCFullYear();
  const y = Number(m[1]);
  const pm = Number(m[2]);
  if (month < pm - 6) return y + 1;
  if (month > pm + 6) return y - 1;
  return y;
}

/** 본문에서 '■ 점검 시간' 같은 머리 다음 줄들 (없으면 본문 처음부터) */
function section(body: string, head: RegExp): string {
  const i = body.search(head);
  return i < 0 ? body : body.slice(i, i + 400);
}

/** 점검 글 하나 -> 점검 시간. 이미 끝난 글(제목에 '종료', '완료')이나 시간을 못 읽으면 null */
export function parseMaint(row: { id: number; title: string; body: string; start_date: string | null }): MaintInfo | null {
  const title = row.title;
  if (/종료\)|\(종료|완료\)|\(완료|점검 완료|종료 안내/.test(title)) return null;
  const part = section(row.body, /점검\s*(시간|일시|일정)/);
  const g = RANGE.exec(part)?.groups;
  if (!g) return null;
  const sm = Number(g.sm ?? g.sm2);
  const sd = Number(g.sd ?? g.sd2);
  const year = yearFor(row.start_date, sm);
  const [sh, smi] = clock(g.sap, g.sh, g.smi ?? g.smi2, g.ssfx);
  const start = kst(year, sm, sd, sh, smi);
  let end: number | null = null;
  if (!g.open) {
    const em = g.em ?? g.em2 ? Number(g.em ?? g.em2) : sm;
    const ed = g.ed ?? g.ed2 ? Number(g.ed ?? g.ed2) : sd;
    // 줄 긋기가 글자로만 남아 '17:00~17:30 18:00' 처럼 시간이 더 붙어 있으면 맨 뒤 시간이 끝
    const tail = g.tail?.match(/(\d{1,2}):(\d{2})\s*$/);
    const [eh, emi] = tail ? [Number(tail[1]), Number(tail[2])] : clock(g.eap, g.eh, g.emi ?? g.emi2, g.esfx);
    end = kst(yearFor(row.start_date, em), em, ed, eh, emi);
    // 같은 날짜로 적었는데 끝이 시작보다 이르면 자정을 넘긴 것
    if (end <= start) end += 24 * HOUR;
  }
  const label = /긴급/.test(title) ? "긴급 점검" : /임시/.test(title) ? "임시 점검" : /정기/.test(title) ? "정기 점검" : "점검";
  const serverLine = /점검\s*서버\s*\n+\s*-?\s*([^\n]+)/.exec(row.body)?.[1]?.trim() ?? "";
  const servers = !serverLine || /전\s*서버|모든\s*서버/.test(serverLine) ? null : /서버/.test(serverLine) ? serverLine : serverLine + " 서버";
  // 정기 점검 글: '(10/29 인스턴스 던전 제한시간: 09:29 ~ 15:00)'
  let dungeonFrom: number | null = null;
  const dz = /인스턴스\s*던전\s*제한\s*시간\s*:?\s*([^\n]*)/.exec(row.body);
  const dt = dz ? ONLY_TIME.exec(dz[1])?.groups : undefined;
  if (dt) {
    const [h, mi] = clock(dt.aap, dt.ah, dt.ami ?? dt.ami2, dt.asfx);
    const at = kst(year, sm, sd, h, mi);
    if (at < start && start - at < 6 * HOUR) dungeonFrom = at;
  }
  return { id: row.id, label, start, end, servers, extended: /연장/.test(title), dungeonFrom };
}

/** 지금 띄울 점검들: 끝나기 전 것 (끝을 모르면 시작하고 12시간까지). 시작 순서 */
export function activeMaint(rows: { id: number; title: string; body: string; start_date: string | null }[], now = Date.now()): MaintInfo[] {
  return rows
    .map(parseMaint)
    .filter((m): m is MaintInfo => !!m && (m.end !== null ? m.end > now : now < m.start + 12 * HOUR) && m.start - now < 14 * 24 * HOUR)
    .sort((a, b) => a.start - b.start);
}
