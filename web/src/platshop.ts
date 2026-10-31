// 1군 전용 플래티넘 할인 상점 (서버 server/platshop.ts, functions/api/shop). 화면 pages/PlatShop.tsx
import { api } from "./auth";

export const SHOP_PIC = "/data/shop/";

export interface ShopSettings {
  ratio: number;
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
  manager?: boolean;
  manage?: { pending: ShopOrder[]; recent: ShopOrder[]; total: Ledger; month: Ledger } | null;
}

export const fetchShop = () => api<ShopData>("/api/shop");
export const orderItem = (itemId: string) => api<{ id: number }>("/api/shop/orders", "POST", { itemId });
export const actOrder = (id: number, action: "done" | "cancel") => api<{ status: string }>(`/api/shop/orders/${id}`, "PATCH", { action });
export const saveShopSettings = (s: ShopSettings) => api<ShopSettings>("/api/shop", "PUT", s);
export const saveShopItem = (id: string, r: { enabled: boolean; ratio: number | null; limitCount: number | null; limitWeeks: number | null }) =>
  api<{ ok: boolean }>(`/api/shop/items/${id}`, "PUT", r);

/** 할인가를 시중 비율로 치면 몇 플래티넘어치인지: 500 플래티넘을 5:100 (시중 7:100)으로 사면 357 */
export const platWorth = (it: Pick<ShopItem, "plat" | "ratio">, market: number) => Math.round((it.plat * it.ratio) / market);

/** 할인율 (시중가 대비) */
export const discount = (it: Pick<ShopItem, "gold" | "marketGold">) =>
  it.marketGold > 0 ? Math.round((1 - it.gold / it.marketGold) * 100) : 0;
