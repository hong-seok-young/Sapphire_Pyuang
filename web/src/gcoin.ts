// 2군 성장코인샵 (개발중, 서버 server/gcoin.ts, functions/api/gcoin): 2군 본캐가 레벨업할 때마다 성장코인이 쌓이고(높은 레벨일수록 많이),
// 주간 2군 성장 1·2·3위는 보너스. 코인으로 상점 물건을 신청하면 오피서가 게임 안에서 주고 '지급 완료'를 누른다.
import { api } from "./auth";
import type { Job } from "./auth";

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
  /** 성장코인 = 관리자가 적은 골드 가치(천 골드). 0 이면 값을 정하기 전 */
  price: number;
  /** 담당자가 적은 골드 가치 (원 단위). 코인 = gold / 1000 반올림 */
  gold: number;
  active: boolean;
}
export type GcStatus = "pending" | "done" | "reject" | "cancel";
export const STATUS_NAME: Record<GcStatus, string> = {
  pending: "기다리는 중",
  done: "지급 완료",
  reject: "반려",
  cancel: "취소",
};
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
  /** 길드 랭킹과 같은 얼굴 (캐릭터 사진, 없으면 직업 엠블럼) */
  job: Job;
  avatar: number | null;
  highSpec?: boolean;
}
/** 2주 목표 선착순 (시범운영, 서버 server/gcrace.ts) */
export interface GcRaceEntry {
  id: string;
  fromLevel: number;
  target: number;
  level: number;
  exp: number | null;
  job: Job;
  avatar: number | null;
  highSpec: boolean;
  /** 목표를 처음 찍은 때 (아직이면 null) */
  doneAt: number | null;
  /** 달성률 0~100 */
  pct: number;
  rank: number;
  /** 1~5위 달성자의 상금 */
  coins: number;
}
export interface GcRace {
  start: number;
  end: number;
  /** 끝난 뒤 다음 판의 시작·끝 (안 정했으면 null) */
  next?: number | null;
  nextEnd?: number | null;
  /** 쉬는 주에 다음 판에 정해 둔 목표 */
  upcoming?: { id: string; fromLevel: number; target: number }[] | null;
  /** 1~5위 상금 */
  prizes: number[];
  list: GcRaceEntry[];
  /** 사람마다 [때, 달성률] (추월 차트) */
  series: Record<string, [number, number][]>;
}
/** 레벨을 저장해 달성률이 오르거나 목표를 찍었을 때 (팝업) */
export interface RaceGain {
  target: number;
  fromLevel: number;
  prevPct: number;
  pct: number;
  justDone: boolean;
  rank: number;
  coins: number;
}
export const RACE_EVENT = "sapphire:gcrace";

export interface GcData {
  open: boolean;
  /** 한 주 상한 (낱개, 띄어쓰기 없는 이름: 사나운멧돼지인형 30)과 이번 주 내가 신청한 수 */
  caps?: Record<string, number>;
  weekBought?: Record<string, number>;
  /** 레벨·경험치마다 코인 (지금 시범운영은 꺼짐: 2주 목표 선착순만) */
  levelCoins: boolean;
  race: GcRace;
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
  admin?: { pending: GcOrder[]; recent: GcOrder[]; members: GcWallet[]; results?: GcRoundResult[]; people?: GcPerson[]; hidden?: string[] };
}

/** 주간 목표 대상으로 고를 수 있는 사람 (레벨을 적은 계정 모두, guild main = 1군 · second = 2군, main = 본캐 아이디면 부캐) */
export interface GcPerson {
  id: string;
  level: number;
  guild: string | null;
  main: string | null;
}
/** 끝난 판의 결과 한 줄 (담당자 > 기록) */
export interface GcRoundResult {
  round: number;
  start: number;
  end: number;
  rank: number;
  userId: string;
  fromLevel: number;
  target: number;
  level: number;
  exp: number | null;
  doneAt: number | null;
  pct: number;
  coins: number;
}

export const fetchGcoin = () => api<GcData>("/api/gcoin");
/** 담당자: 이번 2주 목표 레벨 (null 이면 뺀다) */
/** 판 기간 정하기: 한국 시간 from 날 0시 ~ to 날 24시 ('2026-11-11') */
export const setRound = (from: string, to: string) =>
  api<{ ok: boolean }>("/api/gcoin/round", "PUT", { from, to });
export const setTarget = (userId: string, target: number | null, from?: number) =>
  api<{ ok: boolean }>("/api/gcoin/targets", "PUT", { userId, target, from });
/** 담당자: 목표 목록에서 빼기 (2군 본캐가 저절로 다시 들어오지 않게) */
export const hideTarget = (userId: string) => api<{ ok: boolean }>("/api/gcoin/targets", "PUT", { userId, hide: true });
export const buyItem = (itemId: number, qty: number) =>
  api<{ ok: boolean; balance: number }>("/api/gcoin/orders", "POST", {
    itemId,
    qty,
  });
export const actOrder = (
  id: number,
  action: "done" | "reject" | "cancel" | "reopen",
  note?: string | null,
) => api<{ ok: boolean }>(`/api/gcoin/orders/${id}`, "PATCH", { action, note });
export const saveGcSettings = (input: {
  levels?: GcCurve[];
  rank?: number[];
  cap?: { name: string; n: number };
}) => api<{ ok: boolean }>("/api/gcoin/settings", "PUT", input);
export const addGcItem = (input: {
  name: string;
  unit: string | null;
  gold: number;
}) => api<{ ok: boolean }>("/api/gcoin/items", "POST", input);
export const editGcItem = (
  id: number,
  input: Partial<{
    name: string;
    unit: string | null;
    gold: number;
    active: boolean;
  }>,
) => api<{ ok: boolean }>(`/api/gcoin/items/${id}`, "PATCH", input);
export const deleteGcItem = (id: number) =>
  api<{ ok: boolean }>(`/api/gcoin/items/${id}`, "DELETE");
export const adjustCoin = (userId: string, delta: number, note: string) =>
  api<{ ok: boolean }>("/api/gcoin/adjust", "POST", { userId, delta, note });

/** 레벨 L 에 올라서는 데 주는 코인 (서버 server/gcoin.ts coinFor 와 같다) */
export function coinFor(level: number, curve: GcCurve[]): number {
  let c = 0;
  for (const r of curve) if (level >= r.minLevel) c = r.coin;
  return c;
}

/** 경험치 몇 % 마다 코인 몇 개 (서버 server/gcoin.ts stepOf 와 같다: 레벨 코인을 나누어떨어지는 가장 작은 깔끔한 % 칸으로) */
const STEPS = [10, 20, 25, 50, 100];
export function stepOf(c: number): { pct: number; coin: number } {
  if (c <= 0) return { pct: 100, coin: 0 };
  for (const pct of STEPS)
    if ((c * pct * 10) % 1000 === 0) return { pct, coin: (c * pct) / 100 };
  return { pct: 100, coin: c };
}
export const pctText = (n: number) =>
  (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "")) + "%";

/** 지갑 카드의 경험치 막대 이정표: 코인이 들어오는 칸(10% 이상)마다 표시 하나, 지난 것·다음 것 */
export function nextGoal(w: GcWallet, curve: GcCurve[]) {
  if (w.top === null) return null;
  const c = coinFor(w.top + 1, curve);
  if (c <= 0) return null;
  const step = stepOf(c);
  const pct = (w.topExp ?? 0) / 1000;
  const done = Math.floor(pct / step.pct + 1e-6);
  const marks = Array.from({ length: Math.round(100 / step.pct) }, (_, i) => ({
    at: (i + 1) * step.pct,
    coin: step.coin,
    state: i < done ? "on" : i === done ? "next" : "off",
  }));
  return { level: w.top, pct, step, marks };
}

/** 코인표를 '구간 -> 코인' 줄로 (Lv.21~25 10, Lv.26~30 15 …). 0 코인 구간은 뺀다. 마지막은 만렙 55 까지 */
export function curveRows(
  curve: GcCurve[],
  max = 55,
): { from: number; to: number; coin: number }[] {
  const sorted = [...curve].sort((a, b) => a.minLevel - b.minLevel);
  return sorted
    .map((r, i) => ({
      from: r.minLevel,
      to: (sorted[i + 1]?.minLevel ?? max + 1) - 1,
      coin: r.coin,
    }))
    .filter((r) => r.coin > 0 && r.from <= max);
}

/** 물건 그림이 있는 이름 (게임 거래소 스샷에서 자른 칸, 자료 scripts/make_gcoin_icons.py -> data/gcoin/<이름(띄어쓰기 없이)>.png).
 * 칸 오른쪽 아래 개수 표가 한 통(자몽주스·자몽케이크 50, 피닉스의심장 5(게임 상점 스샷), 나머지 20)이다 */
const PICS = new Set([
  "사나운멧돼지인형",
  "망고워터",
  "자몽주스",
  "자몽케이크",
  "우파우파의노래",
  "잠깬쿠이인형",
  "별과자",
  "동그리사탕",
  "데블랑사탕",
  "딸기빙수",
  "꿀사과",
  "알사탕",
  "자라의노래",
  "피닉스의심장",
]);
export function itemPic(name: string): string | null {
  let key = name.replace(/\s/g, "");
  if (/멧돼지/.test(key)) key = "사나운멧돼지인형";
  if (/피닉스|피닉|피심/.test(key)) key = "피닉스의심장";
  // ?v=2: 밝은 칸으로 바꾼 그림 (2026-11-10, 하루 캐시라 바로 새 그림을 받게. 그림을 다시 바꾸면 올린다)
  return PICS.has(key) ? `/data/gcoin/${encodeURIComponent(key)}.png?v=2` : null;
}

/** 물건 옵션 (게임 정보창 그대로, 고정이라 관리자가 적지 않는다. 제작자 2026-11-09 '옵션은 고정인데, 상점에서 템을 누르면 옵션이 뜨게').
 * 제작자가 보낸 거래소 스샷의 정보창에 보인 것만. 키는 띄어쓰기 없는 이름. 새 물건 옵션을 받으면 여기에 더한다 */
const ITEM_INFO: Record<string, string[]> = {
  망고워터: ["쿨타임 60초", "20분 동안 지속: 크리티컬 4 증가"],
  사나운멧돼지인형: ["쿨타임 5초", "20분 동안 지속: 데미지 30% 증가"],
  우파우파의노래: ["쿨타임 5초", "20분 동안 지속: 경험치 10% 증가"],
  동그리사탕: ["쿨타임 5초", "20분 동안 지속: 크리티컬 4 증가"],
  알사탕: ["쿨타임 5초", "20분 동안 지속: 크리티컬 3 증가"],
  꿀사과: ["쿨타임 5초", "20분 동안 지속: 크리티컬 4 증가"],
  딸기빙수: ["쿨타임 60초", "60초 동안 지속: 이동속도 15 증가"],
  잠깬쿠이인형: ["쿨타임 5초", "20분 동안 지속: 데미지 20% 증가"],
  별과자: ["쿨타임 5초", "20분 동안 지속: 크리티컬 5 증가"],
  데블랑사탕: ["쿨타임 5초", "20분 동안 지속: 크리티컬 5 증가"],
  자라의노래: ["쿨타임 5초", "20분 동안 지속: 경험치 30% 증가"],
  피닉스의심장: ["사용: 제자리에서 부활"],
  자몽주스: [
    "쿨타임 5초",
    "요구 레벨 27",
    "10초 동안 지속: 초당 100 마나 회복",
  ],
  자몽케이크: [
    "쿨타임 5초",
    "요구 레벨 27",
    "10초 동안 지속: 초당 100 체력 회복",
  ],
};
/** 골드 -> 성장코인 (서버 server/gcoin.ts coinOfGold 와 같다) */
/** 성장코인 1개 = 3만 골드 (김다혜 2026-11-09, 서버 server/gcoin.ts COIN_GOLD) */
export const COIN_GOLD = 30_000;
export const coinOfGold = (gold: number) =>
  gold > 0 ? Math.max(1, Math.round(gold / COIN_GOLD)) : 0;
export const itemInfo = (name: string): string[] =>
  ITEM_INFO[name.replace(/\s/g, "")] ?? [];

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

/** 파는 단위 (제작자 2026-11-09 '자몽주스와 자몽케이크는 50개 단위, 나머지는 20개'): 새 물건·묶음의 처음 개수 */
export const packOf = (name: string) =>
  /자몽/.test(name) ? 50 : /멧돼지/.test(name) ? 10 : 20;
/** '20개' -> 20 (단위에 개수가 없으면 1) */
export const qtyOf = (unit: string | null) =>
  Number(/(\d+)\s*개/.exec(unit ?? "")?.[1] ?? 1) || 1;

/** '자몽주스 100개' (50개 묶음 x 2. 서버 orderLabel 과 같다) */
export function itemLabel(o: {
  name: string;
  unit: string | null;
  qty?: number;
}): string {
  const n = Number(/(\d+)\s*개/.exec(o.unit ?? "")?.[1]);
  if (n) return `${o.name} ${(n * (o.qty ?? 1)).toLocaleString("ko-KR")}개`;
  return `${o.name}${o.unit ? ` ${o.unit}` : ""}${o.qty && o.qty > 1 ? ` x${o.qty}` : ""}`;
}

/** 내 캐릭터가 2군 본캐가 아닐 때(앱개발자는 1군) 보이는 예시 지갑. 화면에만 있고 서버에는 안 간다 */
export const SAMPLE_WALLET: GcWallet = {
  id: "예시",
  level: 34,
  base: 31,
  baseExp: 40000,
  top: 34,
  topExp: 52000,
  earned: 116,
  milestone: 0,
  bonus: 80,
  adjust: 0,
  spent: 155,
  balance: 41,
};
export const SAMPLE_HISTORY: GcData["history"] = {
  levels: [
    { level: 34, coin: 20, pct: 52 },
    { level: 34, coin: 40, pct: null },
    { level: 33, coin: 35, pct: null },
    { level: 32, coin: 21, pct: null },
  ],
  milestones: [],
  ledger: [
    {
      delta: 20,
      kind: "streak",
      note: "2주 연속 성장",
      at: Date.now() - 2 * 86_400_000,
    },
    {
      delta: 60,
      kind: "rank",
      note: "주간 2군 성장 2위 (그 주 +52코인)",
      at: Date.now() - 2 * 86_400_000,
    },
  ],
  orders: [
    {
      id: -1,
      user: "예시",
      itemId: null,
      name: "사나운 멧돼지 인형",
      unit: "20개",
      price: 120,
      qty: 1,
      status: "done",
      note: null,
      at: Date.now() - 86_400_000,
      doneAt: Date.now() - 80_000_000,
      doneBy: "멍멍",
    },
    {
      id: -2,
      user: "예시",
      itemId: null,
      name: "망고워터",
      unit: "20개",
      price: 35,
      qty: 1,
      status: "pending",
      note: null,
      at: Date.now() - 3_600_000,
      doneAt: null,
      doneBy: null,
    },
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
  /** 지금 레벨에서 경험치 몇 % 마다 코인 몇 개 (팝업 막대의 이정표) */
  step?: { pct: number; coin: number };
}
export const COIN_EVENT = "sapphire:gcoin";

/** 이번에 넘은 구간 한마디 (가장 높은 것 하나) */
export function milestone(from: number, to: number): string | null {
  const hit = (l: number) => Math.floor(from) < l && Math.floor(to) >= l;
  if (hit(55)) return "만렙 달성!";
  if (Math.floor(to) > Math.floor(from)) return `Lv.${Math.floor(to)} 달성!`;
  return null;
}

/**
 * 예시 판 (제작자 2026-11-09 '테스트 데이터 몇 개 넣어 주고'): 목표를 아직 아무도 안 정했으면 성장 현황에 '예시'로 보인다 (서버로 가지 않음).
 * 시작 때부터 7일 동안 몇 번 적은 것처럼, 추월이 두 번 일어난다
 */
export function sampleRace(start: number, now: number): GcRace {
  const d = (x: number) => Math.min(now, start + x * 86_400_000);
  // 2군 길드원 닉네임과 공지의 목표로 (제작자 2026-11-09 '테스트 데이터 많이, 우리 길드원 닉네임 활용해서'). [닉네임, 직업, 시작 Lv, 목표 Lv, [며칠째, 달성률]...]
  const P: [string, Job, number, number, [number, number][]][] = [
    ["펀취", "monk", 36, 37, [[0.0, 20], [1.8, 46], [3.5, 71], [5.2, 100]]],
    ["혈천도마", "warrior", 30, 32, [[0.0, 30], [1.2, 42], [3.2, 58], [5.5, 79], [7.2, 100]]],
    ["체인소맨", "warrior", 34, 36, [[0.0, 10], [2.2, 35], [4.5, 61], [6.5, 83], [8.5, 100]]],
    ["무도가", "monk", 31, 33, [[0.0, 40], [2.8, 52], [5.0, 66], [7.5, 90], [9.8, 96]]],
    ["가져가", "ranger", 33, 35, [[0.0, 0], [1.0, 15], [4.0, 47], [7.0, 70], [9.0, 88]]],
    ["춘천다크갈비", "monk", 31, 33, [[0.0, 55], [3.8, 61], [6.0, 74], [9.5, 82]]],
    ["먼쥐", "monk", 32, 34, [[0.0, 25], [2.0, 38], [5.0, 50], [8.2, 77]]],
    ["도아햄", "mage", 34, 36, [[0.0, 5], [3.0, 30], [6.2, 49], [9.2, 68]]],
    ["마가목", "ranger", 32, 34, [[0.0, 45], [4.8, 51], [7.8, 60]]],
    ["이름뭐로짓지", "mage", 34, 36, [[0.0, 0], [5.5, 22], [8.8, 41]]],
    ["미즈로바", "ranger", 23, 28, [[0.0, 4], [2.5, 14], [5.8, 25], [9.8, 36]]],
    ["도등", "warrior", 21, 27, [[0.0, 2], [4.2, 15], [8.0, 27]]],
  ];
  const series: Record<string, [number, number][]> = {};
  const list: GcRaceEntry[] = P.map(([id, job, from, target, pts]) => {
    // 열흘짜리로 적은 점을 7일 판에 맞춰 0.7 배로
    series[id] = pts
      .map(([x, p]) => [x * 0.7, p] as [number, number])
      .filter(([x]) => start + x * 86_400_000 <= now)
      .map(([x, p]) => [d(x), p]);
    const last = series[id][series[id].length - 1]?.[1] ?? 0;
    const done = last >= 100 ? series[id][series[id].length - 1][0] : null;
    const pos = from + ((target - from) * last) / 100;
    return {
      id,
      fromLevel: from,
      target,
      level: Math.floor(pos),
      exp: Math.round((pos % 1) * 100_000),
      job,
      avatar: null,
      highSpec: false,
      doneAt: done,
      pct: last,
      rank: 0,
      coins: 0,
    };
  });
  list.sort((a, b) =>
    a.doneAt !== null || b.doneAt !== null
      ? (a.doneAt ?? Infinity) - (b.doneAt ?? Infinity)
      : b.pct - a.pct,
  );
  const prizes = [6, 4, 3, 2, 2];
  list.forEach((e, i) => {
    e.rank = i + 1;
    if (e.doneAt !== null) e.coins = prizes[i] ?? 0;
  });
  return { start, end: start + 7 * 86_400_000, prizes, list, series };
}
