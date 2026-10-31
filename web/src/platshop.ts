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

/** 내 플래티넘 지갑: 매주(목요일 오전 10시) 지급되고 쌓인다. 신청하면 빠지고 취소하면 돌아온다 */
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

/** 할인율 (시중가 대비) */
export const discount = (gold: number, marketGold: number) => (marketGold > 0 ? Math.round((1 - gold / marketGold) * 100) : 0);

/** 플래티넘을 골드로: 비율이 5 면 플래티넘 100 = 5만 골드 (서버 goldOf 와 같다) */
export const goldOf = (plat: number, ratio: number) => Math.round((plat / 100) * ratio * 10_000);

/** 아이모 게임 상점의 플래티넘 상품: 개수와 정가 (원, 2026-10-31 제작자 스샷) */
export const PLAT_PACKS = [
  { plat: 13000, won: 110_000 },
  { plat: 6250, won: 55_000 },
  { plat: 2400, won: 22_000 },
  { plat: 1150, won: 11_000 },
  { plat: 550, won: 5_500 },
  { plat: 315, won: 3_300 },
  { plat: 100, won: 1_100 },
];

/** 적어도 plat 만큼을 정가로 가장 싸게 사는 상품 묶음. 큰 상품으로 대부분 채우고 나머지만 따져 본다 */
export function packsFor(plat: number) {
  const big = PLAT_PACKS[0];
  const bulk = Math.max(0, Math.floor(plat / big.plat) - 1);
  const rest = Math.max(0, plat - bulk * big.plat);
  // cost[p]: p 개 이상을 사는 가장 싼 값, last[p]: 그때 마지막에 산 상품
  const cost = new Array<number>(rest + 1).fill(Infinity);
  const last = new Array<number>(rest + 1).fill(-1);
  cost[0] = 0;
  for (let p = 1; p <= rest; p++) {
    PLAT_PACKS.forEach((k, i) => {
      const c = cost[Math.max(0, p - k.plat)] + k.won;
      if (c < cost[p]) {
        cost[p] = c;
        last[p] = i;
      }
    });
  }
  const counts = PLAT_PACKS.map(() => 0);
  counts[0] = bulk;
  for (let p = rest; p > 0; p = Math.max(0, p - PLAT_PACKS[last[p]].plat)) counts[last[p]]++;
  return packsOf(counts);
}

/** 상품마다 산 개수(PLAT_PACKS 순서)를 묶음으로 */
export function packsOf(counts: number[]) {
  const packs = PLAT_PACKS.map((k, i) => ({ ...k, count: counts[i] })).filter((k) => k.count > 0);
  return { packs, plat: packs.reduce((a, k) => a + k.plat * k.count, 0), won: packs.reduce((a, k) => a + k.won * k.count, 0) };
}

/** 정가로 won 원 안에서 플래티넘을 가장 많이 사는 묶음 (상품 값은 모두 100원 단위). 큰 상품으로 대부분 채우고 나머지만 따져 본다 */
export function packsWithin(won: number) {
  const big = PLAT_PACKS[0];
  const bulk = Math.max(0, Math.floor(won / big.won) - 1);
  const units = Math.max(0, Math.floor((won - bulk * big.won) / 100));
  // most[u]: 100원 x u 안에서 가장 많은 플래티넘, last[u]: 그때 마지막에 산 상품
  const most = new Array<number>(units + 1).fill(0);
  const last = new Array<number>(units + 1).fill(-1);
  for (let u = 1; u <= units; u++) {
    most[u] = most[u - 1];
    last[u] = -2; // 100원 남김
    PLAT_PACKS.forEach((k, i) => {
      const c = k.won / 100;
      if (c <= u && most[u - c] + k.plat > most[u]) {
        most[u] = most[u - c] + k.plat;
        last[u] = i;
      }
    });
  }
  const counts = PLAT_PACKS.map(() => 0);
  counts[0] = bulk;
  for (let u = units; u > 0; ) {
    if (last[u] === -2) u--;
    else {
      counts[last[u]]++;
      u -= PLAT_PACKS[last[u]].won / 100;
    }
  }
  return packsOf(counts);
}

/**
 * 예산 (제작자 요청 2026-10-31): 길마가 원스토어 할인으로 아이모 플래티넘을 결제하고, 그 플래티넘으로 산 물건을 1군과 고스펙에게
 * 할인된 골드로 넘긴다. 1군 n명, 고스펙 h명이 weeks 주 동안 주당 플래티넘을 다 쓴다고 칠 때 필요한 플래티넘, 받는 골드와 시중가.
 * 사는 묶음과 결제할 돈은 화면에서 정한다 (packsFor, packsWithin). 물건마다 비율을 따로 정했으면 실제와 조금 다르다
 */
export function budget(s: ShopSettings, n: number, h: number, weeks: number) {
  const group = (people: number, weekPlat: number, ratio: number) => {
    const plat = people * weekPlat * weeks;
    return { people, weekPlat, ratio, plat, gold: goldOf(plat, ratio), market: goldOf(plat, s.market) };
  };
  const rows = [
    { name: "1군", ...group(n, s.weekPlat, s.ratio) },
    { name: "고스펙", ...group(h, s.highWeekPlat, s.highRatio) },
  ];
  const sum = (k: "plat" | "gold" | "market") => rows.reduce((a, r) => a + r[k], 0);
  return { plat: sum("plat"), gold: sum("gold"), market: sum("market"), rows };
}
