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
  /** 처음 넘은 레벨 보너스 (Lv.30 · 38 · 45 · 55) */
  milestone: number;
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
export interface GcMilestone {
  level: number;
  coin: number;
  name: string;
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
    /** 처음 넘은 레벨 보너스 */
    milestones: GcMilestone[];
    ledger: { delta: number; kind: string; note: string | null; at: number }[];
    orders: GcOrder[];
  };
  items: GcItem[];
  curve: GcCurve[];
  rank: number[];
  week: { start: number; top: GcRankEntry[] };
  lastWinners: { id: string; delta: number; note: string | null; at: number }[];
  /** 다음에 처음 넘으면 받을 레벨 보너스 */
  nextMilestone: GcMilestone | null;
  /** 연속 성장: 지난주까지 이어진 주 수, 이번 주도 벌면 받을 보너스 */
  streak: { count: number; next: number };
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

/** 물건 그림이 있는 이름 (게임 거래소 스샷에서 자른 칸, 자료 scripts/make_gcoin_icons.py -> data/gcoin/<이름(띄어쓰기 없이)>.png).
 * 칸 오른쪽 아래 개수 표가 한 통(자몽주스·자몽케이크 50, 나머지 20)이다 */
const PICS = new Set(["사나운멧돼지인형", "망고워터", "자몽주스", "자몽케이크", "우파우파의노래", "잠깬쿠이인형", "별과자", "동그리사탕", "데블랑사탕", "딸기빙수", "꿀사과", "알사탕", "칠면조구이", "송편", "자라의노래"]);
export function itemPic(name: string): string | null {
  let key = name.replace(/\s/g, "");
  if (/멧돼지/.test(key)) key = "사나운멧돼지인형";
  return PICS.has(key) ? `/data/gcoin/${encodeURIComponent(key)}.png` : null;
}

/** 그림이 없는 물건(오피서가 새로 넣은 것)의 그림 글자 */
export function itemIcon(name: string): string {
  if (/멧돼지/.test(name)) return "🐗";
  if (/망고/.test(name)) return "🥭";
  if (/주스/.test(name)) return "🧃";
  if (/케이크/.test(name)) return "🍰";
  if (/노래|우파/.test(name)) return "🎵";
  if (/사탕|과자/.test(name)) return "🍬";
  if (/도핑|물약|포션/.test(name)) return "🧪";
  return "🎁";
}

/** 한 통의 개수 (제작자 2026-11-09 '자몽주스와 자몽케이크는 통당 50개, 나머지는 한 통에 20개') */
export const tongOf = (name: string) => (/자몽/.test(name) ? 50 : 20);
/** 묶음 이름: 한 통이면 '1통(20개)' */
export const unitOf = (name: string, qty: number) => (qty === tongOf(name) ? `1통(${qty}개)` : `${qty}개`);

export const itemLabel = (o: { name: string; unit: string | null; qty?: number }) => `${o.name}${o.unit ? ` ${o.unit}` : ""}${o.qty && o.qty > 1 ? ` x${o.qty}` : ""}`;

/** 내 캐릭터가 2군 본캐가 아닐 때(앱개발자는 1군) 보이는 예시 지갑. 화면에만 있고 서버에는 안 간다 */
export const SAMPLE_WALLET: GcWallet = { id: "예시", level: 34, base: 31, baseExp: 40000, top: 34, topExp: 52000, earned: 116, milestone: 0, bonus: 80, adjust: 0, spent: 155, balance: 41 };
export const SAMPLE_HISTORY: GcData["history"] = {
  levels: [
    { level: 34, coin: 20, pct: 52 },
    { level: 34, coin: 40, pct: null },
    { level: 33, coin: 35, pct: null },
    { level: 32, coin: 21, pct: null },
  ],
  milestones: [],
  ledger: [
    { delta: 20, kind: "streak", note: "2주 연속 성장", at: Date.now() - 2 * 86_400_000 },
    { delta: 60, kind: "rank", note: "주간 2군 성장 2위 (그 주 +52코인)", at: Date.now() - 2 * 86_400_000 },
  ],
  orders: [
    { id: -1, user: "예시", itemId: null, name: "사나운 멧돼지 인형", unit: "1통(20개)", price: 120, qty: 1, status: "done", note: null, at: Date.now() - 86_400_000, doneAt: Date.now() - 80_000_000, doneBy: "멍멍" },
    { id: -2, user: "예시", itemId: null, name: "망고워터", unit: "1통(20개)", price: 35, qty: 1, status: "pending", note: null, at: Date.now() - 3_600_000, doneAt: null, doneBy: null },
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
  /** 저장 전 이번 주 순위 */
  prevRank: number | null;
  /** 이번에 처음 넘은 레벨 보너스 */
  milestones: GcMilestone[];
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
