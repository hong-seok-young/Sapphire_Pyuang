// 길드 던전 (제작자 요청 2026-11-02, 1군 전용, 서버 server/gdungeon.ts, functions/api/gd):
// 4인 파티가 이번 주(목 10시 ~ 다음 주 목 10시) 가능한 때를 시간표(09:00 ~ 02:00, 30분 칸)에 칠하면, 모두 되는 때가 빠른 순으로 1번, 2번 … 후보.
// 지금 후보에 각자 확정·불참: 모두 확정하면 정해지고, 한 사람이라도 불참하면 그 후보는 무산되고 다음 후보로 (정한 뒤에도 불참할 수 있다).
import { api } from "./auth";

export const SLOT_MS = 30 * 60_000;
/** 한 주의 30분 칸 수 (목 10:00 부터) */
export const SLOTS = 336;
/** 하루 칸 수: 09:00 ~ 다음 날 02:00 */
export const ROWS = 34;
export const COLS = 7;
export const MAX_MEMBERS = 4;
const DAY = 86_400_000;
const KST = 9 * 3_600_000;

/** 칸 번호: 열(목 0 ~ 수 6)과 줄(09:00 0 ~ 01:30 33). 주는 목 10:00 에 시작해서 하루의 09:00 은 그보다 2칸 앞 */
export const slotOf = (col: number, row: number) => col * 48 - 2 + row;
export const validSlot = (i: number) => Number.isInteger(i) && i >= 0 && i < SLOTS && (i + 2) % 48 < ROWS && Math.floor((i + 2) / 48) < COLS;
export const EMPTY = "0".repeat(SLOTS);

export interface PartyState {
  id: number;
  name: string;
  leader: string;
  /** 길드던전 단계 (파티장·운영진이 정한다, 없으면 null) */
  stage: number | null;
  members: { id: string; filled: boolean }[];
  avail: Record<string, string>;
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
  /** 파티 명단을 숨긴 동안(서버 GD_PARTIES_OPEN = false, 제작자 2026-11-03 '공지 후 반영') 미리 보는 사람이 아니면 true: 내 시간표만 */
  hidden?: boolean;
  party: PartyState | null;
  mine: string | null;
  prev: string | null;
  parties: PartySummary[];
  people: GdPerson[];
  staff: boolean;
}

export const fetchGd = () => api<GdData>("/api/gd");
export const createParty = (members: string[]) => api<{ id: number }>("/api/gd", "POST", { members });
export const saveAvail = (slots: string) => api<{ ok: boolean; party?: PartyState | null }>("/api/gd/avail", "PUT", { slots });
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
/** 후보 번호 (빠른 순 1부터, 무산된 것도 센다) */
export const candidateNo = (p: PartyState, slot: number) => p.candidates.indexOf(slot) + 1;
