// 장비대여 (제작자 요청 2026-11-01, 서버 server/rental.ts, functions/api/rent): 길드가 기부받은 무기를 기한(없음, 1~52주)마다 💎 가격으로 빌려준다.
// 💎 1개 = 10만 골드. 장비를 기부하면 운영진이 옵션 시세로 마일리지 💎 를 적립하고, 빌릴 때 골드 대신 쓴다. 실제 주고받기는 게임 안에서.
import { api } from "./auth";
import { JOBS, JOB_NAME } from "./auth";
import type { Job } from "./auth";
import type { Item, Wiki } from "./types";

/** 대여 기한: 'none' 기한 없음, '3w' 3주 (1~52주. 제작자 요청 2026-11-02: 2주·4주로 고정하지 말고. 서버 server/rentalParse.ts 와 같은 값) */
export type RentTerm = "none" | `${number}w`;
export const MAX_WEEKS = 52;
/** 기한의 주 수 (기한 없음이면 null) */
export function termWeeks(t: RentTerm | string | null | undefined): number | null {
  const m = typeof t === "string" ? /^(\d{1,2})w$/.exec(t) : null;
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= MAX_WEEKS ? n : null;
}
/** '4주', '기한 없음' */
export const termName = (t: RentTerm) => {
  const w = termWeeks(t);
  return w === null ? "기한 없음" : `${w}주`;
};

/**
 * 물건의 직업 칸 (제작자 요청 2026-11-02: 공용이거나 전사·레인저처럼 여럿일 수도): 'warrior', 'warrior,ranger', 네 직업 모두면 공용.
 * 목록은 그 직업 칸마다 보인다 (서버 server/rental.ts readJobs)
 */
export const jobsOf = (s: string | null | undefined): Job[] => JOBS.filter((j) => (s ?? "").split(",").includes(j));
/** 위키 장비를 쓰는 직업: 무기는 그 직업, 방어구·장신구는 '직업' 칸 ('공용'이면 넷 다) */
export function wikiJobs(it: Item): Job[] {
  const out = new Set<Job>();
  for (const e of it.equip ?? []) {
    const w = JOBS.find((j) => e.slot === `${JOB_NAME[j]} 무기`);
    if (w) out.add(w);
    else {
      const t = e.info?.["직업"] ?? "";
      for (const j of JOBS) if (t.includes("공용") || t.includes(JOB_NAME[j])) out.add(j);
    }
  }
  return JOBS.filter((j) => out.has(j));
}
/** '공용', '전사·레인저', '전사' */
export function jobsText(s: string | null | undefined): string {
  const js = jobsOf(s);
  return js.length === JOBS.length ? "공용" : js.map((j) => JOB_NAME[j]).join("·");
}

export type ReqStatus = "wait" | "ok" | "done" | "no" | "cancel";
export const STATUS_NAME: Record<ReqStatus, string> = { wait: "확인 전", ok: "수락", done: "대여 완료", no: "거절", cancel: "취소" };

export interface RentItem {
  id: number;
  /** 직업 하나나 여럿 ('warrior,ranger', 네 직업 모두면 공용). jobsOf */
  job: string;
  level: number;
  weapon: string;
  /** 옵션 줄임말 ('명6크3') */
  options: string;
  enhance: number;
  term: RentTerm;
  /** 💎 */
  price: number;
  donor: string | null;
  note: string | null;
  /** 지금 쓰는 사람 */
  renter: string | null;
  rentedAt: number | null;
  /** 빌린 사람이 반납 신청한 때 (운영진과 빌린 사람에게만) */
  returnReqAt?: number | null;
  /** 반납 날짜를 정하는 대화창 (신청서 번호, data.apps 에 들어 있다) */
  returnAppId?: number | null;
  /** 기한이 끝나는 날 (줄이 있으면 이날 담당자에게 돌려준다) */
  dueAt: number | null;
  /** 줄 선 사람 수 */
  queue: number;
  /** 지금 새로 신청하면 받을 수 있는 때 (null: 앞사람이 반납하면) */
  next: number | null;
  /** 내 신청: 차례와 받을 수 있는 때 */
  mine: { rid: number; status: ReqStatus; pos: number; at: number | null } | null;
  /** 운영진만: 이 물건으로 기부자에게 적립한 💎 */
  donorDia?: number;
  /** 대여 중일 때 받은 보증금 (운영진과 빌린 사람에게만): 마일리지 💎, 골드 */
  deposit?: { dia: number; gold: number };
  /** 운영진만: 줄 명단 */
  line?: { rid: number; user: string; status: ReqStatus; appId: number | null; pos: number; at: number | null }[];
}

export interface AppRequest {
  rid: number;
  itemId: number;
  weapon: string | null;
  enhance: number | null;
  term: RentTerm | null;
  price: number | null;
  status: ReqStatus;
  doneAt: number | null;
  returnedAt: number | null;
  useDia: number;
  /** 지금 이 사람이 쓰고 있는지 */
  holding: boolean;
  /** 줄 서는 중이면 차례와 받을 수 있는 때 */
  pos?: number;
  at?: number | null;
}

/** 신청서 (한 번에 여러 개, 대화창) */
export interface RentApp {
  id: number;
  user: string;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  /** 내 신청서인지 */
  mine: boolean;
  /** 운영진만: 신청한 사람의 마일리지 */
  mileage?: number;
  requests: AppRequest[];
  talk: { id: number; user: string; text: string; at: number }[];
}

export interface LedgerLine {
  /** 장부 줄 번호 (운영진이 보는 기부 현황에서만, 지울 때) */
  id?: number;
  who: string;
  delta: number;
  gold: number | null;
  reason: "donate" | "rent" | "adjust" | "return";
  note: string | null;
  at: number;
  by?: string;
}

export interface RentData {
  items: RentItem[];
  apps: RentApp[];
  manager: boolean;
  /** 💎 1개의 골드 */
  rate: number;
  /** 내 캐릭터들 */
  mine: string[];
  /** 내 마일리지 💎 (묶은 캐릭터 합) */
  mileage: number;
  ledger: LedgerLine[];
  /** 운영진만: 사람마다 마일리지, 닉네임 고르기 목록 */
  /** 운영진: 기부 현황 (남은 💎, 기부로 적립한 💎, 기부 건수) */
  balances?: { person: string; dia: number; at: number; donated: number; count: number }[];
  members?: string[];
}

export const fetchRent = () => api<RentData>("/api/rent");
/** 신청서: 무기 여러 개를 한 번에 (무기마다 선착순으로 줄을 선다) */
export const applyRent = (items: number[], note: string) => api<{ appId: number }>("/api/rent/apply", "POST", { items, note });
/** 신청 하나: accept 수락 / reject 거절 / hand 대여 완료(보증금: 마일리지 💎 와 골드) — 운영진, cancel 취소 — 신청한 사람 */
export const actRequest = (rid: number, action: "accept" | "reject" | "cancel" | "hand", useDia = 0, gold?: number) =>
  api<{ ok: boolean }>(`/api/rent/requests/${rid}`, "POST", { action, useDia, gold });
export const talkRent = (aid: number, text: string) => api<{ id: number; at: number }>(`/api/rent/apps/${aid}/talk`, "POST", { text });
/** 대여 등록 (카톡 등 앱 밖 신청) */
export const lendRent = (id: number, body: { renter: string; useDia: number; gold?: number; date?: string }) =>
  api<{ ok: boolean; dueAt: number | null }>(`/api/rent/${id}/lend`, "POST", body);
export const returnRent = (id: number) => api<{ ok: boolean; refund: { dia: number; gold: number } }>(`/api/rent/${id}/return`, "POST");
/** 빌린 사람의 반납 신청과 취소 (제작자 요청 2026-11-02) */
export const requestReturn = (id: number, opt: { cancel?: boolean; when?: string } = {}) =>
  api<{ ok: boolean; returnReqAt: number | null; returnAppId: number | null }>(`/api/rent/${id}/return-request`, "POST", opt);
export interface RentFields {
  /** 고른 직업 (넷 다면 공용) */
  job: Job[];
  level: number;
  weapon: string;
  options: string;
  enhance: number;
  term: RentTerm;
  price: number;
  donor: string;
  /** 기부자에게 적립할 마일리지 💎 (고치면 차이만 장부에) */
  donorDia: number;
  note: string;
}
export const addRent = (f: RentFields) => api<{ id: number; warning?: string }>("/api/rent", "POST", f);
/** dueAt: 대여 중인 물건의 반납 기한 (ms, 기한 없음은 null). 대여 중이 아니면 넣지 않는다 */
export const editRent = (id: number, f: RentFields, dueAt?: number | null) =>
  api<{ ok: boolean }>(`/api/rent/${id}`, "PUT", dueAt === undefined ? f : { ...f, dueAt });
/** 장비대여 기록 한 줄 (운영 '기록', 제작자 요청 2026-11-02) */
export interface RentLogRow {
  id: number;
  itemId: number;
  weapon: string | null;
  enhance: number | null;
  job: string | null;
  itemStatus: string | null;
  user: string;
  rentedAt: number | null;
  returnedAt: number | null;
  by: string | null;
  useDia: number;
  gold: number | null;
}
export const fetchRentLog = () => api<{ log: RentLogRow[] }>("/api/rent/log");
export const deleteRentLog = (id: number) => api<{ ok: boolean }>(`/api/rent/log?id=${id}`, "DELETE");
export const deleteMileageLine = (id: number) => api<{ ok: boolean }>(`/api/rent/mileage?id=${id}`, "DELETE");
export const removeRent = (id: number) => api<{ ok: boolean }>(`/api/rent/${id}`, "DELETE");
export const fetchMileage = (who: string) =>
  api<{ who: string; names: string[]; mileage: number; ledger: LedgerLine[] }>(`/api/rent/mileage?who=${encodeURIComponent(who)}`);
export const addMileage = (who: string, delta: number, reason: "donate" | "adjust", note: string) =>
  api<{ ok: boolean; mileage: number }>("/api/rent/mileage", "POST", { who, delta, reason, note });

/** 옵션 줄임말 -> [짧은 이름, 값] ('명6크3' -> 명중 6, 크리 3). 한 줄에 들어가게 짧게 (제작자 요청 2026-11-02). 마재(마나재생)를 마(마나)보다 먼저 */
const OPTION_NAME: Record<string, string> = { 마재: "마재", 명: "명중", 크: "크리", 힘: "힘", 민: "민첩", 지: "지능", 마: "마나", 체: "체력", 이속: "이속", 속저: "속저" };
/** 줄임말 -> 위키 옵션 이름 (정보창), 위키 옵션 이름 -> 줄임말 (물건 추가의 옵션 칸) */
const OPTION_FULL: Record<string, string> = {
  마재: "마나재생", 명: "명중", 크: "크리티컬", 힘: "힘", 민: "민첩", 지: "지능", 마: "마나", 체: "체력", 이속: "이동속도", 속저: "속성저항",
};
export const OPTION_SHORT: Record<string, string> = Object.fromEntries(Object.entries(OPTION_FULL).map(([k, v]) => [v, k]));
const OPTION_RE = /(마재|이속|속저|명|크|힘|민|지|마|체)\s*(\d{1,3})/g;
export function optionParts(options: string): [string, number][] {
  const out: [string, number][] = [];
  for (let m = OPTION_RE.exec(options); m; m = OPTION_RE.exec(options)) out.push([OPTION_NAME[m[1]], Number(m[2])]);
  OPTION_RE.lastIndex = 0;
  return out;
}
/** 옵션 줄임말 -> 위키 이름과 값 ('명6크3' -> [['명중', 6], ['크리티컬', 3]]) */
export function optionFull(options: string): [string, number][] {
  const out: [string, number][] = [];
  for (let m = OPTION_RE.exec(options); m; m = OPTION_RE.exec(options)) out.push([OPTION_FULL[m[1]], Number(m[2])]);
  OPTION_RE.lastIndex = 0;
  return out;
}
/** 위키 이름과 값 -> 줄임말 (0 은 빼고): [['명중', 6], ['크리티컬', 3]] -> '명6크3' */
export function optionShort(values: [string, number][]): string {
  return values.filter(([, v]) => v > 0).map(([n, v]) => `${OPTION_SHORT[n] ?? n}${v}`).join("");
}

/** 위키의 그 무기 (띄어쓰기는 보지 않는다: '폭풍채찍' = '폭풍 채찍') */
export function weaponOf(wiki: Wiki, name: string): Item | undefined {
  if (wiki.items[name]) return wiki.items[name];
  const key = name.replace(/\s+/g, "");
  return Object.values(wiki.items).find((it) => it.name.replace(/\s+/g, "") === key);
}
/** 위키의 레벨제한 (없으면 목록에 적힌 레벨) */
export function levelOf(wiki: Wiki, r: { weapon: string; level: number }): number {
  const lv = Number(weaponOf(wiki, r.weapon)?.equip?.[0]?.info?.["레벨제한"]);
  return Number.isInteger(lv) && lv > 0 ? lv : r.level;
}

/** 골드 -> '80만' */
export function manGold(gold: number): string {
  if (!gold) return "0";
  return gold >= 100_000_000 ? `${(gold / 100_000_000).toLocaleString()}억` : `${Math.round(gold / 10_000).toLocaleString()}만`;
}
/** 💎 -> '120만' 골드 */
export function diaGold(dia: number, rate = 100_000): string {
  if (!dia) return "0";
  const man = (dia * rate) / 10_000;
  return man >= 10_000 ? `${(man / 10_000).toLocaleString()}억` : `${man.toLocaleString()}만`;
}
/** 한국 시간 '11/19' */
export function md(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
