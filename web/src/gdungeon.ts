// 길드 던전 (제작자 요청 2026-11-02, 1군 전용, 서버 server/gdungeon.ts, functions/api/gd):
// 4인 파티가 이번 주(목 10:30 ~ 다음 주 목 10:30, 게임의 길드 던전 초기화 때. 서버 week.ts gdWeekStart) 가능한 때를 시간표(09:00 ~ 02:00, 30분 칸)에 칠하면,
// 모두 되는 때가 빠른 순으로 1번, 2번 … 후보.
// 지금 후보에 각자 확정·불참: 모두 확정하면 정해지고, 한 사람이라도 불참하면 그 후보는 무산되고 다음 후보로 (정한 뒤에도 불참할 수 있다).
import { api } from "./auth";

export const SLOT_MS = 30 * 60_000;
/** 한 주의 30분 칸 수 (목 10:30 부터) */
export const SLOTS = 336;
/** 하루 칸 수: 09:00 ~ 다음 날 02:00 */
export const ROWS = 34;
export const COLS = 7;
export const MAX_MEMBERS = 4;
const DAY = 86_400_000;
const KST = 9 * 3_600_000;

/** 칸 번호: 열(목 0 ~ 수 6)과 줄(09:00 0 ~ 01:30 33). 주는 목 10:30 에 시작해서 하루의 09:00 은 그보다 3칸 앞 (첫 목요일 09:00~10:30 은 없는 칸) */
export const slotOf = (col: number, row: number) => col * 48 - 3 + row;
export const validSlot = (i: number) => Number.isInteger(i) && i >= 0 && i < SLOTS && (i + 3) % 48 < ROWS && Math.floor((i + 3) / 48) < COLS;
export const EMPTY = "0".repeat(SLOTS);

export interface PartyState {
  id: number;
  name: string;
  leader: string;
  /** 길드던전 단계 (파티장·운영진이 정한다, 없으면 null) */
  stage: number | null;
  /** filled = 시간표를 저장한 적이 있다, confirmed = 칠하고 '확정'을 눌렀다 (카드의 '입력 전 / 확정') */
  members: { id: string; filled: boolean; confirmed?: boolean }[];
  avail: Record<string, string>;
  /** 다음 주 것 (오늘부터 7일 칸의 지난 요일 자리). 예전 서버면 없다 */
  availNext?: Record<string, string>;
  candidates: number[];
  rejected: { slot: number; by: string[] }[];
  current: number | null;
  yes: string[];
  confirmed: number | null;
}
export interface PartySummary {
  id: number;
  name: string;
  leader: string;
  stage: number | null;
  members: string[];
  confirmed: number | null;
  current: number | null;
}
export interface GdPerson {
  id: string;
  job: string | null;
  level: number | null;
  party: number | null;
}
export interface GdData {
  week: number;
  end: number;
  now: number;
  party: PartyState | null;
  mine: string | null;
  /** 내 다음 주 시간표 (오늘부터 7일 칸의 지난 요일 자리) */
  mineNext?: string | null;
  /** 내 시간표를 확정했는지 (서버 gd_avail.confirmed_at, 칠한 칸이 있을 때만) */
  mineConfirmed?: boolean;
  prev: string | null;
  parties: PartySummary[];
  /** 다른 파티의 전체 상태 (구경용: 카드, 후보, 시간표). 예전 서버면 없다 */
  others?: PartyState[];
  people: GdPerson[];
  staff: boolean;
}

export const fetchGd = () => api<GdData>("/api/gd");
export const createParty = (members: string[]) => api<{ id: number }>("/api/gd", "POST", { members });
/** 내 시간표 '확정': 이번 주 처음이면 아직 안 칠한 파티원에게 알림 (서버 functions/api/gd/confirm.ts) */
export const confirmAvail = () => api<{ ok: boolean; nudged: number; party?: PartyState | null }>("/api/gd/confirm", "POST");
/** '수정': 확정을 풀어 파티원 카드가 다시 '입력 전' */
export const unconfirmAvail = () => api<{ ok: boolean; party?: PartyState | null }>("/api/gd/confirm", "DELETE");
/** 이번 주(slots)·다음 주(next) 중 바뀐 것만 보낸다 */
export const saveAvail = (change: { slots?: string; next?: string }) => api<{ ok: boolean; party?: PartyState | null }>("/api/gd/avail", "PUT", change);
export const answerGd = (slot: number, answer: "yes" | "no") => api<{ ok: boolean; party?: PartyState | null }>("/api/gd/answer", "POST", { slot, answer });
export const undoAnswer = (slot: number) => api<{ ok: boolean; party?: PartyState | null }>(`/api/gd/answer?slot=${slot}`, "DELETE");
export const resetGd = () => api<{ ok: boolean; party?: PartyState | null }>("/api/gd/answer", "POST", { reset: true });
export const editParty = (id: number, change: { add?: string[]; remove?: string[]; leader?: string; stage?: number | null }) =>
  api<{ ok: boolean; party?: PartyState | null }>(`/api/gd/party/${id}`, "PUT", change);
export const leaveParty = (id: number) => api<{ ok: boolean }>(`/api/gd/party/${id}`, "PUT", { leave: true });
export const deleteParty = (id: number) => api<{ ok: boolean }>(`/api/gd/party/${id}`, "DELETE");

const kst = (ms: number) => new Date(ms + KST);
const two = (n: number) => String(n).padStart(2, "0");
export const DAY_NAME = "일월화수목금토";

/** '11/7(금) 21:00' */
export function slotText(week: number, i: number): string {
  const d = kst(week + i * SLOT_MS);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DAY_NAME[d.getUTCDay()]}) ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}
/** '금 21:00' (짧게) */
export function slotShort(week: number, i: number): string {
  const d = kst(week + i * SLOT_MS);
  return `${DAY_NAME[d.getUTCDay()]} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}
/** 열 머리: '목', '11/5' (그 열은 그날 09:00 부터 다음 날 02:00 까지) */
export function colHead(week: number, col: number): { day: string; date: string } {
  const d = kst(week + col * DAY);
  return { day: DAY_NAME[d.getUTCDay()], date: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` };
}
/** 줄 이름: 짝수 줄(정각)만 '09' … '01' */
export const rowLabel = (row: number) => (row % 2 ? "" : two((9 + row / 2) % 24));
/** '11/5(목) 10:00 ~ 11/12(목) 10:00' */
export function weekText(week: number, end: number): string {
  const f = (ms: number) => {
    const d = kst(ms);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DAY_NAME[d.getUTCDay()]}) ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  };
  return `${f(week)} ~ ${f(end)}`;
}
/**
 * 시간표 화면 (제작자 2026-11-04 '열 순서를 월화수목금토일로, 지나간 날짜는 없애고 화요일이면 월요일은 다음 주 월요일 날짜'):
 * 열은 늘 월 ~ 일, 날짜는 오늘부터 7일 안의 그 요일 (지난 요일은 다음 주). 하루는 09:00 ~ 다음 날 02:00 이라 02:00 전까지는 어제를 오늘로 본다.
 * 칸마다 실제 때로 이번 주(목 10:30 ~)·다음 주 시간표의 자리를 찾는다: 칸 키 = 주(0 이번 주, 1 다음 주) x 336 + 칸 번호. 시간표에 없는 때는 -1.
 * 칠해 둔 시간은 실제 날짜·시각 그대로라 열만 바뀐다 (제작자 '이미 입력돼 있는 거에서 열만 바꿔 주는 거야').
 */
export const WEEK = 7 * DAY;
export interface GridCol {
  day: string;
  date: string;
  /** 그날 09:00 (한국 시간)의 때 */
  base: number;
  today: boolean;
}
export function gridCols(now: number): GridCol[] {
  const k = kst(now - 2 * 3_600_000);
  const mid = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST;
  const dow = k.getUTCDay();
  return [1, 2, 3, 4, 5, 6, 0].map((w) => {
    const off = (w - dow + 7) % 7;
    const day0 = mid + off * DAY;
    const d = kst(day0);
    return { day: DAY_NAME[w], date: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, base: day0 + 9 * 3_600_000, today: off === 0 };
  });
}
/** 그 칸(열의 09:00 + 줄 x 30분)의 키: 이번 주면 칸 번호, 다음 주면 336 + 칸 번호, 시간표에 없는 때는 -1 */
export function cellKey(week: number, col: GridCol, row: number): number {
  const t = col.base + row * SLOT_MS;
  if (t < week) return -1;
  const next = t >= week + WEEK;
  if (t >= week + 2 * WEEK) return -1;
  const slot = Math.round((t - (next ? week + WEEK : week)) / SLOT_MS);
  return validSlot(slot) ? (next ? SLOTS : 0) + slot : -1;
}
/** 칸 키의 때 '11/7(금) 21:00' */
export const keyText = (week: number, k: number) => (k >= SLOTS ? slotText(week + WEEK, k - SLOTS) : slotText(week, k));
/** 칸 키가 이번 주 칸이면 그 번호 (후보 표시는 이번 주만), 아니면 -1 */
export const thisWeekSlot = (k: number) => (k >= 0 && k < SLOTS ? k : -1);
/** 그 사람이 칸 키에 되는지 (이번 주 avail, 다음 주 availNext) */
export const freeAt = (p: PartyState, id: string, k: number) =>
  k < 0 ? false : k >= SLOTS ? p.availNext?.[id]?.[k - SLOTS] === "1" : p.avail[id]?.[k] === "1";

/** 후보 번호 (빠른 순 1부터, 무산된 것도 센다) */
export const candidateNo = (p: PartyState, slot: number) => p.candidates.indexOf(slot) + 1;
