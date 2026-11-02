// 장비대여 (제작자 요청 2026-11-01, 서버 server/rental.ts, functions/api/rent): 길드가 기부받은 무기를 기한(없음, 4주, 2주)마다 💎 가격으로 빌려준다.
// 💎 1개 = 10만 골드. 장비를 기부하면 운영진이 옵션 시세로 마일리지 💎 를 적립하고, 빌릴 때 골드 대신 쓴다. 실제 주고받기는 게임 안에서.
import { api } from "./auth";
import type { Job } from "./auth";
import type { Item, Wiki } from "./types";

export type RentTerm = "none" | "4w" | "2w";
export const TERMS: RentTerm[] = ["none", "4w", "2w"];
export const TERM_NAME: Record<RentTerm, string> = { none: "기한 없음", "4w": "4주", "2w": "2주" };

export type ReqStatus = "wait" | "ok" | "done" | "no" | "cancel";
export const STATUS_NAME: Record<ReqStatus, string> = { wait: "확인 전", ok: "수락", done: "건네받음", no: "거절", cancel: "취소" };

export interface RentItem {
  id: number;
  job: Job;
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
  who: string;
  delta: number;
  gold: number | null;
  reason: "donate" | "rent" | "adjust";
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
  balances?: { person: string; dia: number; at: number }[];
  members?: string[];
}

export const fetchRent = () => api<RentData>("/api/rent");
/** 신청서: 무기 여러 개를 한 번에 (무기마다 선착순으로 줄을 선다) */
export const applyRent = (items: number[], note: string) => api<{ appId: number }>("/api/rent/apply", "POST", { items, note });
/** 신청 하나: accept 수락 / reject 거절 / hand 건네줌(마일리지 💎) — 운영진, cancel 취소 — 신청한 사람 */
export const actRequest = (rid: number, action: "accept" | "reject" | "cancel" | "hand", useDia = 0) =>
  api<{ ok: boolean }>(`/api/rent/requests/${rid}`, "POST", { action, useDia });
export const talkRent = (aid: number, text: string) => api<{ id: number; at: number }>(`/api/rent/apps/${aid}/talk`, "POST", { text });
/** 직접 대여 (카톡 등 앱 밖 신청) */
export const lendRent = (id: number, body: { renter: string; useDia: number; date?: string }) =>
  api<{ ok: boolean; dueAt: number | null }>(`/api/rent/${id}/lend`, "POST", body);
export const returnRent = (id: number) => api<{ ok: boolean }>(`/api/rent/${id}/return`, "POST");
export interface RentFields {
  job: Job;
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
export const editRent = (id: number, f: RentFields) => api<{ ok: boolean }>(`/api/rent/${id}`, "PUT", f);
export const removeRent = (id: number) => api<{ ok: boolean }>(`/api/rent/${id}`, "DELETE");
export interface ImportSummary {
  jobs: Job[];
  add: number;
  keep: number;
  gone: number;
  goneRented: number;
  skipped: string[];
  applied?: boolean;
}
export const importRent = (text: string, apply: boolean) => api<ImportSummary>("/api/rent/import", "POST", { text, apply });
export const fetchMileage = (who: string) =>
  api<{ who: string; names: string[]; mileage: number; ledger: LedgerLine[] }>(`/api/rent/mileage?who=${encodeURIComponent(who)}`);
export const addMileage = (who: string, delta: number, reason: "donate" | "adjust", note: string) =>
  api<{ ok: boolean; mileage: number }>("/api/rent/mileage", "POST", { who, delta, reason, note });

/** 옵션 줄임말 -> [짧은 이름, 값] ('명6크3' -> 명중 6, 크리 3). 한 줄에 들어가게 짧게 (제작자 요청 2026-11-02). 마재(마나재생)를 마(마나)보다 먼저 */
const OPTION_NAME: Record<string, string> = { 마재: "마재", 명: "명중", 크: "크리", 힘: "힘", 민: "민첩", 지: "지능", 마: "마나" };
export function optionParts(options: string): [string, number][] {
  const out: [string, number][] = [];
  const re = /(마재|명|크|힘|민|지|마)\s*(\d{1,3})/g;
  for (let m = re.exec(options); m; m = re.exec(options)) out.push([OPTION_NAME[m[1]], Number(m[2])]);
  return out;
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
