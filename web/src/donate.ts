// 기부함 (개발중, 서버 server/donate.ts, 화면 pages/Donate.tsx)
import { api } from "./auth";
import type { Job } from "./auth";

export type DonateStatus = "request" | "done" | "rejected" | "removed";
export type DonatePlace = "keep" | "rent" | "used";

export interface DonateRow {
  id: number;
  who: string;
  item: string;
  qty: number;
  enhance: number;
  note: string | null;
  gold_ask: number | null;
  gold: number | null;
  dia: number;
  status: DonateStatus;
  place: DonatePlace;
  rental_id: number | null;
  created_at: number;
  created_by: string;
  done_at: number | null;
  done_by: string | null;
}

export interface HallRow {
  name: string;
  names: string[];
  gold: number;
  count: number;
  mileage: number;
  last: number;
  job: Job | null;
  avatar: number | null;
  highSpec: boolean;
}

export interface GiftLine {
  id: string;
  who: string;
  label: string;
  gold: number;
  dia: number;
  at: number;
  from: "box" | "rent";
  place?: DonatePlace;
}

export interface DonateData {
  manage: boolean;
  period: "all" | "month";
  hall: HallRow[];
  lines: GiftLine[];
  mine: DonateRow[];
  staff?: { pending: DonateRow[]; store: DonateRow[] };
}

/** 💎 1개 = 10만 골드 (장비대여와 같다) */
export const DIA_GOLD = 100_000;

export const fetchDonate = (period: "all" | "month") => api<DonateData>(`/api/donate?period=${period}`);

export interface DonateInput {
  item: string;
  qty: number;
  enhance: number;
  note: string;
  gold: number | null;
}
export const askDonate = (v: DonateInput) => api<{ id: number }>("/api/donate", "POST", v);
export const addDonate = (who: string, v: DonateInput) =>
  api<{ id: number; dia: number; mileage: number }>("/api/donate", "POST", { ...v, who, confirm: true });
export const confirmDonate = (id: number, v: Partial<DonateInput>) =>
  api<{ dia: number; mileage: number }>(`/api/donate/${id}`, "PUT", { ...v, action: "confirm" });
export const editDonate = (id: number, v: DonateInput) =>
  api<{ dia?: number; mileage?: number }>(`/api/donate/${id}`, "PUT", { ...v, action: "edit" });
export const rejectDonate = (id: number) => api(`/api/donate/${id}`, "PUT", { action: "reject" });
export const placeDonate = (id: number, place: "keep" | "used") => api(`/api/donate/${id}`, "PUT", { action: "place", place });
export const rentDonate = (id: number, v: { job: string; level: number; term: string; price: number }) =>
  api<{ rentalId: number }>(`/api/donate/${id}`, "PUT", { ...v, action: "rent" });
export const removeDonate = (id: number) => api<{ dia?: number }>(`/api/donate/${id}`, "DELETE");

/** '+7 헌터보우 x3' */
export const donateLabel = (r: { item: string; qty: number; enhance: number }) =>
  `${r.enhance > 0 ? `+${r.enhance} ` : ""}${r.item}${r.qty > 1 ? ` x${r.qty}` : ""}`;

/** 골드를 '12만', '1.5억', '5,000' 으로 */
export function goldText(g: number): string {
  if (g >= 100_000_000) return `${Math.round(g / 10_000_000) / 10}억`;
  if (g >= 10_000) return `${Math.round(g / 1000) / 10}만`;
  return g.toLocaleString();
}

/** 확정 골드에 들어 있는 💎 (소수 한 자리, '💎 1.5') */
export const diaText = (gold: number) => {
  const d = gold / DIA_GOLD;
  return Number.isInteger(d) ? `${d}` : d.toFixed(1);
};

export const STATUS_NAME: Record<DonateStatus, string> = { request: "확인 전", done: "확정", rejected: "거절", removed: "지움" };
export const PLACE_NAME: Record<DonatePlace, string> = { keep: "보관", rent: "장비대여로", used: "나눔·사용" };

/** '11/10' */
export function dayText(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
