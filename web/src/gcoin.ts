// 2군 성장코인샵 (개발중, 서버 server/gcoin.ts, functions/api/gcoin): 2군 본캐가 레벨업할 때마다 성장코인이 쌓이고(높은 레벨일수록 많이),
// 주간 2군 성장 1·2·3위는 보너스. 코인으로 상점 물건을 신청하면 오피서가 게임 안에서 주고 '지급 완료'를 누른다.
import { api } from "./auth";

export interface GcWallet {
  id: string;
  level: number | null;
  base: number | null;
  baseExp: number | null;
  top: number | null;
  topExp: number | null;
  earned: number;
  bonus: number;
  adjust: number;
  spent: number;
  balance: number;
}
export interface GcItem {
  id: number;
  name: string;
  unit: string | null;
  price: number;
  active: boolean;
}
export type GcStatus = "pending" | "done" | "reject" | "cancel";
export const STATUS_NAME: Record<GcStatus, string> = { pending: "기다리는 중", done: "지급 완료", reject: "반려", cancel: "취소" };
export interface GcOrder {
  id: number;
  user: string;
  itemId: number | null;
  name: string;
  unit: string | null;
  price: number;
  qty: number;
  status: GcStatus;
  note: string | null;
  at: number;
  doneAt: number | null;
  doneBy: string | null;
}
export interface GcCurve {
  minLevel: number;
  coin: number;
}
export interface GcRankEntry {
  id: string;
  /** 그 주에 레벨·경험치로 번 코인 */
  coins: number;
  fromLevel: number;
  level: number;
}
export interface GcData {
  open: boolean;
  manage: boolean;
  /** 내가 2군 본캐인지 (아니면 지갑이 없다) */
  member: boolean;
  start: number;
  wallet: GcWallet | null;
  history: {
    /** 번 코인 내역 (레벨마다, pct 가 있으면 그 레벨을 그 % 까지만 채운 줄) */
    levels: { level: number; coin: number; pct: number | null }[];
    ledger: { delta: number; kind: string; note: string | null; at: number }[];
    orders: GcOrder[];
  };
  items: GcItem[];
  curve: GcCurve[];
  rank: number[];
  week: { start: number; top: GcRankEntry[] };
  lastWinners: { id: string; delta: number; note: string | null; at: number }[];
  admin?: { pending: GcOrder[]; recent: GcOrder[]; members: GcWallet[] };
}

export const fetchGcoin = () => api<GcData>("/api/gcoin");
export const buyItem = (itemId: number, qty: number) => api<{ ok: boolean; balance: number }>("/api/gcoin/orders", "POST", { itemId, qty });
export const actOrder = (id: number, action: "done" | "reject" | "cancel", note?: string | null) =>
  api<{ ok: boolean }>(`/api/gcoin/orders/${id}`, "PATCH", { action, note });
export const saveGcSettings = (input: { levels?: GcCurve[]; rank?: number[] }) => api<{ ok: boolean }>("/api/gcoin/settings", "PUT", input);
export const addGcItem = (input: { name: string; unit: string | null; price: number }) => api<{ ok: boolean }>("/api/gcoin/items", "POST", input);
export const editGcItem = (id: number, input: Partial<{ name: string; unit: string | null; price: number; active: boolean }>) =>
  api<{ ok: boolean }>(`/api/gcoin/items/${id}`, "PATCH", input);
export const deleteGcItem = (id: number) => api<{ ok: boolean }>(`/api/gcoin/items/${id}`, "DELETE");
export const adjustCoin = (userId: string, delta: number, note: string) => api<{ ok: boolean }>("/api/gcoin/adjust", "POST", { userId, delta, note });

/** 레벨 L 에 올라서는 데 주는 코인 (서버 server/gcoin.ts coinFor 와 같다) */
export function coinFor(level: number, curve: GcCurve[]): number {
  let c = 0;
  for (const r of curve) if (level >= r.minLevel) c = r.coin;
  return c;
}

/** 코인표를 '구간 -> 코인' 줄로 (Lv.21~25 10, Lv.26~30 15 …). 0 코인 구간은 뺀다. 마지막은 만렙 55 까지 */
export function curveRows(curve: GcCurve[], max = 55): { from: number; to: number; coin: number }[] {
  const sorted = [...curve].sort((a, b) => a.minLevel - b.minLevel);
  return sorted
    .map((r, i) => ({ from: r.minLevel, to: (sorted[i + 1]?.minLevel ?? max + 1) - 1, coin: r.coin }))
    .filter((r) => r.coin > 0 && r.from <= max);
}

/** 물건 이름으로 고른 그림 (물건 그림이 따로 없어서) */
export function itemIcon(name: string): string {
  if (/멧돼지/.test(name)) return "🐗";
  if (/망고/.test(name)) return "🥭";
  if (/주스/.test(name)) return "🧃";
  if (/케이크/.test(name)) return "🍰";
  if (/노래|우파/.test(name)) return "🎵";
  if (/도핑|물약|포션/.test(name)) return "🧪";
  return "🎁";
}

export const itemLabel = (o: { name: string; unit: string | null; qty?: number }) => `${o.name}${o.unit ? ` ${o.unit}` : ""}${o.qty && o.qty > 1 ? ` x${o.qty}` : ""}`;

/** 내 캐릭터가 2군 본캐가 아닐 때(앱개발자는 1군) 보이는 예시 지갑. 화면에만 있고 서버에는 안 간다 */
export const SAMPLE_WALLET: GcWallet = { id: "예시", level: 34, base: 31, baseExp: 40000, top: 34, topExp: 52000, earned: 116, bonus: 60, adjust: 0, spent: 78, balance: 98 };
export const SAMPLE_HISTORY: GcData["history"] = {
  levels: [
    { level: 34, coin: 20, pct: 52 },
    { level: 34, coin: 40, pct: null },
    { level: 33, coin: 35, pct: null },
    { level: 32, coin: 21, pct: null },
  ],
  ledger: [{ delta: 60, kind: "rank", note: "주간 2군 성장 2위 (그 주 +52코인)", at: Date.now() - 2 * 86_400_000 }],
  orders: [
    { id: -1, user: "예시", itemId: null, name: "사나운 멧돼지", unit: "10개", price: 60, qty: 1, status: "done", note: null, at: Date.now() - 86_400_000, doneAt: Date.now() - 80_000_000, doneBy: "멍멍" },
    { id: -2, user: "예시", itemId: null, name: "망고워터", unit: "10개", price: 18, qty: 1, status: "pending", note: null, at: Date.now() - 3_600_000, doneAt: null, doneBy: null },
  ],
};

/** 레벨·경험치를 저장했을 때 서버가 같이 돌려주는 새 코인 (server/gcoin.ts CoinGain). src/auth.ts saveMyProfile 이 'sapphire:gcoin' 으로 알린다 */
export interface CoinGain {
  gained: number;
  balance: number;
  from: number;
  to: number;
  rank: number | null;
  /** 이번 주 번 코인, 바로 위 사람까지 코인 차이 */
  week: number;
  gap: number | null;
}
export const COIN_EVENT = "sapphire:gcoin";

/** 이번에 넘은 구간 한마디 (가장 높은 것 하나) */
export function milestone(from: number, to: number): string | null {
  const hit = (l: number) => Math.floor(from) < l && Math.floor(to) >= l;
  if (hit(55)) return "만렙 55 달성!";
  if (hit(45)) return "Lv.45 돌파 · 여기부터 레벨당 150코인";
  if (hit(39)) return "Lv.39 돌파 · 레벨당 120코인 구간";
  if (hit(38)) return "Lv.38 · 38제 무기 +8강이면 1군 편입 고려!";
  if (hit(37)) return "Lv.37 · 다음 레벨은 100코인";
  if (hit(30)) return "Lv.30 돌파 · 여기부터 레벨당 35코인";
  if (Math.floor(to) > Math.floor(from)) return `Lv.${Math.floor(to)} 달성!`;
  return null;
}
