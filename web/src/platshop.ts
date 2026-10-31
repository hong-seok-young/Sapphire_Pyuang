// 1군 전용 플래티넘 할인 상점 (서버 server/platshop.ts, functions/api/shop). 화면 pages/PlatShop.tsx
import { api } from "./auth";

export const SHOP_PIC = "/data/shop/";

export interface ShopSettings {
  ratio: number;
  highRatio: number;
  market: number;
  limitCount: number;
  limitWeeks: number;
  open: boolean;
}

export interface ShopItem {
  id: string;
  name: string;
  plat: number;
  count: number;
  tile: string;
  enabled: boolean;
  ratio: number;
  highRatio: number;
  highGold: number;
  limitCount: number;
  limitWeeks: number;
  gold: number;
  marketGold: number;
  custom: boolean;
  /** 한도 기간 안에 내가 신청하거나 산 수 */
  used: number;
}

export interface ShopOrder {
  id: number;
  itemId?: string;
  itemName: string;
  plat: number;
  gold: number;
  status: "requested" | "done" | "cancelled";
  at: number;
  doneAt?: number | null;
  user?: string;
  doneBy?: string | null;
}

export interface Ledger {
  n: number;
  plat: number;
  gold: number;
}

export interface ShopData {
  open: boolean;
  settings?: ShopSettings;
  items?: ShopItem[];
  orders?: ShopOrder[];
  main?: boolean;
  /** 내가 고스펙인지 (고스펙 할인가로 산다) */
  highSpec?: boolean;
  manager?: boolean;
  manage?: { pending: ShopOrder[]; recent: ShopOrder[]; total: Ledger; month: Ledger } | null;
}

export const fetchShop = () => api<ShopData>("/api/shop");
export const orderItem = (itemId: string) => api<{ id: number }>("/api/shop/orders", "POST", { itemId });
export const actOrder = (id: number, action: "done" | "cancel") => api<{ status: string }>(`/api/shop/orders/${id}`, "PATCH", { action });
export const saveShopSettings = (s: ShopSettings) => api<ShopSettings>("/api/shop", "PUT", s);
export const saveShopItem = (
  id: string,
  r: { enabled: boolean; ratio: number | null; highRatio: number | null; limitCount: number | null; limitWeeks: number | null },
) =>
  api<{ ok: boolean }>(`/api/shop/items/${id}`, "PUT", r);

/** 할인가를 시중 비율로 치면 몇 플래티넘어치인지: 500 플래티넘을 5:100 (시중 7:100)으로 사면 357 */
export const platWorth = (it: Pick<ShopItem, "plat" | "ratio">, market: number) => Math.round((it.plat * it.ratio) / market);

/** 할인율 (시중가 대비) */
export const discount = (gold: number, marketGold: number) => (marketGold > 0 ? Math.round((1 - gold / marketGold) * 100) : 0);

/**
 * 예산 (제작자 요청): 1군 n명, 고스펙 h명이 판매 중인 물건을 weeks 주 동안 한도까지 다 산다고 칠 때.
 * 길드가 내는 몫은 시중가와 할인가의 차이 (7:100 을 5:100 으로 팔면 플래티넘 100마다 2만 골드)
 */
export function budget(items: ShopItem[], n: number, h: number, weeks: number) {
  let cost = 0;
  let plat = 0;
  let gold = 0;
  let market = 0;
  const rows = items
    .filter((it) => it.enabled && it.limitCount > 0)
    .map((it) => {
      const buys = it.limitCount * Math.ceil(weeks / it.limitWeeks);
      const c = buys * (n * (it.marketGold - it.gold) + h * (it.marketGold - it.highGold));
      cost += c;
      plat += buys * (n + h) * it.plat;
      market += buys * (n + h) * it.marketGold;
      gold += buys * (n * it.gold + h * it.highGold);
      return { it, buys, cost: c };
    })
    .sort((a, b) => b.cost - a.cost);
  return { cost, plat, gold, market, perWeek: weeks > 0 ? cost / weeks : 0, rows };
}
