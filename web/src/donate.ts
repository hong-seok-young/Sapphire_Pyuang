// 기부함 (개발중, 서버 server/donate.ts, 화면 pages/Donate.tsx)
import { api } from "./auth";
import type { Job } from "./auth";

export type DonateStatus = "request" | "done" | "rejected" | "removed" | "hall";
export type DonatePlace = "keep" | "rent" | "used";

export interface DonateRow {
  id: number;
  who: string;
  item: string;
  qty: number;
  enhance: number;
  note: string | null;
  /** 위키 장비에 뜬 옵션 ('명중 9 · 크리티컬 4') */
  options: string | null;
  /** 장신구 속성부여 ('힘 3') */
  enchant: string | null;
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
  /** 기부 골드 가치 합 */
  gold: number;
  /** 기부로 쌓인 마일리지 (소수, 순위는 이것으로) */
  earned: number;
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
  /** 내 명예의 전당 줄 (쌓인 마일리지, 남은 💎) */
  me: HallRow | null;
  lines: GiftLine[];
  mine: DonateRow[];
  staff?: { pending: DonateRow[]; store: DonateRow[] };
}

/** 💎 1개 = 10만 골드 (장비대여와 같다) */
export const DIA_GOLD = 100_000;
/** 기부 골드 가치의 0.6 이 마일리지 (서버 server/donate.ts MILEAGE_RATE 와 같다. 제작자 2026-11-10) */
export const MILEAGE_RATE = 0.6;

export const fetchDonate = () => api<DonateData>("/api/donate");

export interface HallData {
  period: "all" | "month";
  hall: HallRow[];
  lines: GiftLine[];
  total: { earned: number; gold: number; count: number; people: number };
}
export const fetchHall = (period: "all" | "month") => api<HallData>(`/api/donate/hall?period=${period}`);

export interface DonateInput {
  item: string;
  qty: number;
  enhance: number;
  note: string;
  options: string;
  enchant: string;
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
/** 장비대여 운용: 장비대여 '물건 추가' 목록으로 넘긴다 (undo 면 보관으로 되돌림, 아직 안 올렸을 때만) */
export const rentDonate = (id: number, undo = false) => api(`/api/donate/${id}`, "PUT", { action: "rent", undo });
export const removeDonate = (id: number) => api<{ dia?: number }>(`/api/donate/${id}`, "DELETE");

/** '+7 헌터보우 x3' */
export const donateLabel = (r: { item: string; qty: number; enhance: number }) =>
  `${r.enhance > 0 ? `+${r.enhance} ` : ""}${r.item}${r.qty > 1 ? ` x${r.qty}` : ""}`;

/** 옵션·속성부여·메모 한 줄 ('명중 9 · 크리티컬 4 · 속성부여 힘 3 · 메모') */
export const donateExtra = (r: { options?: string | null; enchant?: string | null; note?: string | null }) =>
  [r.options, r.enchant ? `속성부여 ${r.enchant}` : "", r.note].filter(Boolean).join(" · ");

/** 골드를 '12만', '1.5억', '5,000' 으로 */
export function goldText(g: number): string {
  if (g >= 100_000_000) return `${Math.round(g / 10_000_000) / 10}억`;
  if (g >= 10_000) return `${Math.round(g / 1000) / 10}만`;
  return g.toLocaleString();
}

/** 마일리지 글자 (소수 둘째 자리까지, 끝의 0 은 뺀다: '3', '1.5', '0.36') */
export const mileText = (m: number) => {
  const r = Math.round(m * 100) / 100;
  return Number.isInteger(r) ? r.toLocaleString() : r.toFixed(2).replace(/0$/, "");
};
/** 골드 가치로 쌓이는 마일리지 글자 (x 0.6 / 10만) */
export const diaText = (gold: number) => mileText((gold * MILEAGE_RATE) / DIA_GOLD);

export const STATUS_NAME: Record<DonateStatus, string> = { request: "확인 전", done: "확정", rejected: "거절", removed: "지움", hall: "예전 기부" };
export const PLACE_NAME: Record<DonatePlace, string> = { keep: "보관", rent: "장비대여", used: "나눔·사용" };

/** '11/10' */
export function dayText(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * 명예의 전당 예시 (제작자 2026-11-10 '명예의 전당 우리 길드원 닉네임으로 샘플 데이터 넣어줘'): 기부가 하나도 없으면 '예시' 로 보인다 (서버로 가지 않음).
 * [닉네임, 직업, [며칠 전, 물건, 골드 가치, 장비대여?]...]. 마일리지는 골드 가치 x 0.6 / 10만
 */
export function sampleHall(period: "all" | "month", now = Date.now()): HallData {
  const DAY = 86_400_000;
  const P: [string, Job, [number, string, number, boolean?][]][] = [
    ["마을모금함", "warrior", [[2, "+8 다크스틸소드", 3_200_000], [9, "의지의 망토", 1_800_000], [21, "사나운 멧돼지 인형 x40", 480_000], [40, "+7 강화가죽장갑", 1_500_000, true]]],
    ["유어아너", "ranger", [[1, "+8 헌터보우", 2_600_000], [12, "자몽케이크 x100", 240_000], [33, "+7 윙의날개", 1_900_000, true]]],
    ["멍멍", "mage", [[4, "+7 고요의지팡이", 2_100_000, true], [18, "지능3 목걸이", 900_000]]],
    ["아홀로틀", "monk", [[3, "+8 길로틴", 1_700_000], [27, "피닉스의심장 x10", 120_000]]],
    ["향단", "mage", [[6, "+6 의식용홀", 1_200_000], [15, "검은진액 x100", 350_000]]],
    ["정서", "warrior", [[8, "힘2 벨트", 700_000], [36, "+7 워소드", 800_000, true]]],
    ["퓨앙", "mage", [[5, "+7 나무지팡이", 600_000], [11, "망고워터 x40", 120_000]]],
    ["달팽이", "ranger", [[10, "민첩3 반지", 650_000]]],
    ["간다이", "monk", [[13, "+6 강화가죽장갑", 550_000]]],
    ["별빛하늘", "warrior", [[7, "자몽주스 x100", 240_000], [25, "+5 회색바위 투구", 200_000]]],
    ["현금술사", "ranger", [[16, "+6 헌터보우", 380_000]]],
    ["도리", "mage", [[19, "마나30 망토", 300_000]]],
    ["쿨쿨쿠루미", "monk", [[22, "데블랑사탕 x40", 160_000]]],
    ["백돼쥐", "warrior", [[3, "사나운 멧돼지 인형 x20", 120_000]]],
  ];
  const kst = new Date(now + 9 * 3_600_000);
  const monthStart = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - 9 * 3_600_000;
  const since = period === "month" ? monthStart : 0;
  const lines: GiftLine[] = [];
  const hall: HallRow[] = [];
  for (const [name, job, gifts] of P) {
    const mine = gifts.filter(([d]) => now - d * DAY >= since);
    if (!mine.length) continue;
    let gold = 0;
    mine.forEach(([d, label, g, rent], i) => {
      gold += g;
      lines.push({ id: `s-${name}-${i}`, who: name, label, gold: g, dia: (g * MILEAGE_RATE) / DIA_GOLD, at: now - d * DAY, from: rent ? "rent" : "box" });
    });
    hall.push({
      name,
      names: [name],
      gold,
      earned: (gold * MILEAGE_RATE) / DIA_GOLD,
      count: mine.length,
      mileage: Math.floor((gold * MILEAGE_RATE) / DIA_GOLD),
      last: now - Math.min(...mine.map(([d]) => d)) * DAY,
      job,
      avatar: null,
      highSpec: false,
    });
  }
  hall.sort((a, b) => b.earned - a.earned);
  lines.sort((a, b) => b.at - a.at);
  return {
    period,
    hall,
    lines,
    total: { earned: hall.reduce((s, h) => s + h.earned, 0), gold: hall.reduce((s, h) => s + h.gold, 0), count: lines.length, people: hall.length },
  };
}
