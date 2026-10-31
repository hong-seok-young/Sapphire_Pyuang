// 골드 거래 (사파이어 중개인의 '골드' 칸, 서버: functions/api/gold, server/gold.ts).
// 게임 골드를 원화로 사고팔려는 글과 '거래할래요'. 앱은 돈을 받거나 보내지 않는다.
// 현금거래는 게임 운영정책 위반으로 계정이 정지될 수 있다고 알렸고, 제작자가 그래도 만들라고 했다 (2026-10-31).
import { api } from "./auth";
import { goldWords, wonText } from "./market";
import type { Wanter } from "./market";

export { wonText };

/** 금액은 만 골드 단위 (750 = 750만 골드). 서버 server/gold.ts 와 같다 */
export const MAX_GOLD = 1_000_000;
/** 시세: 1만 원에 몇 만 골드 (75 = 75:1) */
export const MAX_RATE = 9999;
/** 처음 보여 주는 시세 (제작자가 알려 준 요즘 시세) */
export const USUAL_RATE = 75;

export type GoldSide = "sell" | "buy";
export const SIDE_NAME: Record<GoldSide, string> = { sell: "팝니다", buy: "삽니다" };

export interface GoldOffer {
  id: number;
  owner: string;
  side: GoldSide;
  /** 만 골드 */
  gold: number;
  /** 1만 원에 몇 만 골드 */
  rate: number;
  note: string | null;
  status: "open" | "done";
  createdAt: number;
  updatedAt: number;
  wants: number;
  wanted: boolean;
  /** 내 글에만 온다: '거래할래요'를 누른 사람 */
  wanters?: Wanter[];
}

export const fetchGold = () => api<{ offers: GoldOffer[] }>("/api/gold").then((r) => r.offers);
export const createGold = (input: { side: GoldSide; gold: number; rate: number; note: string | null }) =>
  api<GoldOffer>("/api/gold", "POST", input);
export const updateGold = (id: number, change: { status?: "open" | "done"; gold?: number; rate?: number; note?: string | null }) =>
  api<Omit<GoldOffer, "wants" | "wanted" | "wanters">>(`/api/gold/${id}`, "PATCH", change);
export const deleteGold = (id: number) => api<{ ok: boolean }>(`/api/gold/${id}`, "DELETE");
export const wantGold = (id: number, note: string | null) => api<{ wants: number; wanted: boolean }>(`/api/gold/${id}/want`, "PUT", { note });
export const unwantGold = (id: number) => api<{ wants: number; wanted: boolean }>(`/api/gold/${id}/want`, "DELETE");

/** 750 (만 골드) -> "750만 골드" */
export const goldAmountText = (gold: number) => `${goldWords(gold * 10_000)} 골드`;

/** 원화: 만 골드 / 시세 x 1만 원 */
export const wonOf = (gold: number, rate: number) => Math.round((gold * 10_000) / rate);

