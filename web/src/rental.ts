// 장비대여 (제작자 요청 2026-11-01, 서버 server/rental.ts, functions/api/rent): 길드가 기부받은 무기를 기한(없음, 4주, 2주)마다 💎 가격으로 빌려준다.
// 💎 1개 = 10만 골드. 장비를 기부하면 운영진이 옵션 시세로 마일리지 💎 를 적립하고, 빌릴 때 골드 대신 쓴다. 실제 주고받기는 게임 안에서.
import { api } from "./auth";
import type { Job } from "./auth";
import type { Item, Wiki } from "./types";

export type RentTerm = "none" | "4w" | "2w";
export const TERMS: RentTerm[] = ["none", "4w", "2w"];
export const TERM_NAME: Record<RentTerm, string> = { none: "기한 없음", "4w": "4주", "2w": "2주" };

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
  renter: string | null;
  rentedAt: number | null;
  dueAt: number | null;
  note: string | null;
  /** 기다리는 신청 수 */
  waiting: number;
  /** 내 신청 */
  mine: { id: number; useDia: number; note: string | null } | null;
  /** 운영진만: 신청 명단 */
  requests?: { id: number; user: string; useDia: number; note: string | null; at: number }[];
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
export const requestRent = (id: number, useDia: number, note: string) => api<{ ok: boolean }>(`/api/rent/${id}/request`, "POST", { useDia, note });
export const cancelRent = (id: number) => api<{ ok: boolean }>(`/api/rent/${id}/request`, "DELETE");
export const lendRent = (id: number, body: { requestId: number } | { renter: string; useDia: number; date?: string }) =>
  api<{ ok: boolean; dueAt: number | null }>(`/api/rent/${id}/lend`, "POST", body);
export const returnRent = (id: number) => api<{ ok: boolean }>(`/api/rent/${id}/return`, "POST");
export const rejectRent = (rid: number) => api<{ ok: boolean }>(`/api/rent/requests/${rid}`, "POST", { action: "reject" });
export interface RentFields {
  job: Job;
  level: number;
  weapon: string;
  options: string;
  enhance: number;
  term: RentTerm;
  price: number;
  donor: string;
  note: string;
}
export const addRent = (f: RentFields) => api<{ id: number }>("/api/rent", "POST", f);
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

/** 옵션 줄임말 -> [이름, 값] (server/rentalParse.ts optionParts 와 같다). 마재(마나재생)를 마(마나)보다 먼저 */
const OPTION_NAME: Record<string, string> = { 마재: "마나재생", 명: "명중", 크: "크리티컬", 힘: "힘", 민: "민첩", 지: "지능", 마: "마나" };
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
