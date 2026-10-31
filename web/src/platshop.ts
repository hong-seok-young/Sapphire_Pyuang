// 1군 전용 플래티넘 할인 상점 (서버 server/platshop.ts, functions/api/shop). 화면 pages/PlatShop.tsx
import { api } from "./auth";

export const SHOP_PIC = "/data/shop/";

export interface ShopSettings {
  ratio: number;
  highRatio: number;
  market: number;
  limitCount: number;
  limitWeeks: number;
  /** 1군 한 사람에게 매주 지급하는 가상 플래티넘 (제작자 요청: 처음 300, 쌓인다) */
  weekPlat: number;
  /** 고스펙 한 사람의 주당 지급 */
  highWeekPlat: number;
  open: boolean;
}

/** 내 플래티넘 지갑: 매주(월요일 0시) 지급되고 쌓인다. 신청하면 빠지고 취소하면 돌아온다 */
export interface Wallet {
  balance: number;
  granted: number;
  spent: number;
  /** 매주 받는 양 (1군이 아니면 0) */
  weekly: number;
  /** 다음 지급 때 */
  nextAt: number;
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
  gold: number;
  marketGold: number;
  custom: boolean;
  /** 패키지에 들어 있는 것: 게임 'i' 정보창의 칸 그림 (자료/scripts/make_shop_info.py), 제목 아래 작은 글 */
  contents?: { tiles: string[]; note?: string };
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
  wallet?: Wallet;
}

export const fetchShop = () => api<ShopData>("/api/shop");
export const orderItem = (itemId: string) => api<{ id: number }>("/api/shop/orders", "POST", { itemId });
export const actOrder = (id: number, action: "done" | "cancel") => api<{ status: string }>(`/api/shop/orders/${id}`, "PATCH", { action });
export const saveShopSettings = (s: ShopSettings) => api<ShopSettings>("/api/shop", "PUT", s);
export const saveShopItem = (id: string, r: { enabled: boolean; ratio: number | null; highRatio: number | null }) =>
  api<{ ok: boolean }>(`/api/shop/items/${id}`, "PUT", { ...r, limitCount: null, limitWeeks: null });

/** 할인가를 시중 비율로 치면 몇 플래티넘어치인지: 500 플래티넘을 5:100 (시중 7:100)으로 사면 357 */
export const platWorth = (it: Pick<ShopItem, "plat" | "ratio">, market: number) => Math.round((it.plat * it.ratio) / market);

/** 할인율 (시중가 대비) */
export const discount = (gold: number, marketGold: number) => (marketGold > 0 ? Math.round((1 - gold / marketGold) * 100) : 0);

/** 플래티넘을 골드로: 비율이 5 면 플래티넘 100 = 5만 골드 (서버 goldOf 와 같다) */
export const goldOf = (plat: number, ratio: number) => Math.round((plat / 100) * ratio * 10_000);

/**
 * 예산 (제작자 요청): 1군 n명, 고스펙 h명이 weeks 주 동안 주당 플래티넘을 다 쓴다고 칠 때.
 * 길드가 내는 몫은 시중가와 할인가의 차이 (7:100 을 5:100 으로 팔면 플래티넘 100마다 2만 골드).
 * 물건마다 비율을 따로 정했으면 실제와 조금 다르다
 */
export function budget(s: ShopSettings, n: number, h: number, weeks: number) {
  const group = (people: number, weekPlat: number, ratio: number) => {
    const plat = people * weekPlat * weeks;
    const market = goldOf(plat, s.market);
    const gold = goldOf(plat, ratio);
    return { people, weekPlat, ratio, plat, market, gold, cost: market - gold };
  };
  const rows = [
    { name: "1군", ...group(n, s.weekPlat, s.ratio) },
    { name: "고스펙", ...group(h, s.highWeekPlat, s.highRatio) },
  ];
  const sum = (k: "plat" | "market" | "gold" | "cost") => rows.reduce((a, r) => a + r[k], 0);
  const cost = sum("cost");
  return { cost, plat: sum("plat"), gold: sum("gold"), market: sum("market"), perWeek: weeks > 0 ? cost / weeks : 0, rows };
}
