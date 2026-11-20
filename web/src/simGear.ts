// 확률 시뮬레이터의 실제 장비 (제작자 요청 2026-11-04 '강화 대상 장비도 강한 순서가 있으니 그 재화로 노작을 사서 강화', '실제 장비들 넣어서').
// 장비: 위키 장비 표(equipment.json)의 무기(직업마다)와 방어구(갑옷·투구·장갑·신발). '+7로크의검[40~49LV]' 처럼 이미 강화된 이벤트 장비, 거래불가 시작 장비, 상인이 파는 장비는 뺀다.
// 강화 수치: 공식 확률 표의 강화 효과 (120600 전사·레인저·무도가 무기 가산값, 120700 마법사 무기마다, 120900 방어구 기본 방어도마다).
// 마법사 무기는 120700 에 있는 것만 (가산값을 모르면 강화한 데미지를 셀 수 없다).
// 값: 레벨이 높을수록 비싸다 (강한 장비일수록 부서지면 아프다). 장비 값은 행운 코인으로 낸다.
import type { Odds } from "./odds";
import type { Wiki, Pic } from "./types";
import type { Part, Scroll } from "./sim";
import { expectedTo } from "./sim";

export type GearJob = "전사" | "레인저" | "마법사" | "무도가";
export const GEAR_JOBS: GearJob[] = ["전사", "레인저", "마법사", "무도가"];
export type ArmorSlot = "갑옷" | "투구" | "장갑" | "신발";
export const ARMOR_SLOTS: ArmorSlot[] = ["갑옷", "투구", "장갑", "신발"];

export interface Gear {
  name: string;
  part: Part;
  /** 무기면 직업, 방어구면 부위 */
  kind: string;
  /** 방어구를 쓰는 직업 (공용이면 넷 다) */
  jobs: GearJob[];
  lv: number;
  icon: Pic | null;
  /** 무기: 기본 데미지 최소·최대 */
  min?: number;
  max?: number;
  /** 무기: 강화도 -> 가산값 %, 방어구: 강화도 -> 방어도 */
  table: number[];
  price: number;
}

const num = (s: string | undefined) => {
  const v = Number(String(s ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(v) ? v : NaN;
};
const squash = (s: string) => s.replace(/\s/g, "");

/** 노작 값 (코인): 무기 Lv.10 10 · Lv.27 28 · Lv.40 47 · Lv.52 67, 방어구는 그 절반쯤 */
/** 강화 한 번(마법서 한 장) 값 (제작자 2026-11-20 '주문서 SS S A B C D 비용 에스컬레이션' -> 표를 보이니 '좀만 더 싸게'):
 *  등급은 장비 요구 레벨로 (도감 계산기와 같다: D 10 미만 · C 20 미만 · B 30 미만 · A 40 미만 · S 50 미만 · SS), 마법서 종류(일반·축복·아바돈 …)와는 상관없다 */
export type ScrollGrade = "D" | "C" | "B" | "A" | "S" | "SS";
export const scrollGrade = (lv: number): ScrollGrade => (lv < 10 ? "D" : lv < 20 ? "C" : lv < 30 ? "B" : lv < 40 ? "A" : lv < 50 ? "S" : "SS");
export const SCROLL_COIN: Record<ScrollGrade, number> = { D: 1, C: 1, B: 2, A: 3, S: 4, SS: 6 };
export const scrollCost = (g: { lv: number }) => SCROLL_COIN[scrollGrade(g.lv)];
/** 장비 값 (제작자 2026-11-20 '무기 구매가 너무 비싸, 파괴될 때마다 사야 하잖아, 에스컬레이션은 주되 싸게'): 레벨이 높을수록 비싸되 예전의 1/3 쯤.
 *  무기 Lv.6 3 · Lv.27 9 · Lv.44 17 · Lv.52 21, 방어구 Lv.44 11 (예전 무기 7 · 28 · 54 · 67, 방어구 32). 수리(1/4)·자동 해금(5·10배)·시세도 같이 내려간다 */
export const gearPrice = (part: Part, lv: number) => (part === "무기" ? 2 + Math.round(lv ** 1.5 / 20) : 1 + Math.round(lv ** 1.5 / 30));

function tableRows(odds: Odds, key: string) {
  return odds.tables.find((t) => t.key === key)?.sections[0]?.r ?? [];
}

export function gearOf(wiki: Wiki, odds: Odds): Gear[] {
  const common = tableRows(odds, "120600").map((r) => Number(r[1]));
  const mage = new Map(tableRows(odds, "120700").map((r) => [squash(r[0]), r.slice(1).map(Number)]));
  const armor = new Map(tableRows(odds, "120900").map((r) => [num(r[0]), r.slice(1).map(Number)]));
  const out: Gear[] = [];
  const seen = new Set<string>();
  for (const t of wiki.equipment) {
    const weaponJob = GEAR_JOBS.find((j) => t.slot === `${j} 무기`);
    const slot = ARMOR_SLOTS.find((s) => t.slot === s);
    if (!weaponJob && !slot) continue;
    const head = t.headers;
    for (const row of t.rows) {
      const h = row.h ?? head;
      const cell = (name: string) => row.cells[h.indexOf(name)];
      const name = row.name.trim();
      if (!name || /^\+|\[/.test(name) || seen.has(name)) continue;
      if ((cell("옵션") ?? "").includes("거래불가")) continue;
      // 상인이 파는 장비는 뺀다 (제작자 2026-11-04 '철검 회색레이피어 빼', '이런 상인이 파는 건가? 이런 거 좀 다 빼': 획득처가 '무기상인 NPC')
      if ((cell("획득처") ?? "").includes("상인")) continue;
      const lv = num(cell("레벨제한"));
      if (!Number.isFinite(lv) || lv < 5) continue;
      if (weaponJob) {
        const m = /(\d+)\s*[-~]\s*(\d+)/.exec(cell("공격") ?? "");
        if (!m) continue;
        const table = weaponJob === "마법사" ? mage.get(squash(name)) : common;
        if (!table || table.length < 16) continue;
        seen.add(name);
        out.push({ name, part: "무기", kind: weaponJob, jobs: [weaponJob], lv, icon: row.icon, min: Number(m[1]), max: Number(m[2]), table, price: gearPrice("무기", lv) });
      } else if (slot) {
        const def = num(cell("방어력"));
        if (!Number.isFinite(def) || def < 1) continue;
        const job = cell("직업") ?? "";
        const jobs = GEAR_JOBS.filter((j) => job.includes(j));
        const table = armor.get(def) ?? Array.from({ length: 16 }, (_, k) => def + k);
        seen.add(name);
        out.push({ name, part: "갑옷", kind: slot, jobs: jobs.length ? jobs : GEAR_JOBS, lv, icon: row.icon, table, price: gearPrice("갑옷", lv) });
      }
    }
  }
  return out.sort((a, b) => a.lv - b.lv || a.name.localeCompare(b.name, "ko"));
}

/** 장비 시세 (2026-11-17 고도화, 제작자 '너무 허접해' -> 강화한 장비를 코인으로 팔아 다음 장비 값으로): +0 은 산 값의 반,
 *  강화한 장비는 '+0 노작을 그 강화도까지 만드는 데 드는 평균 코인'(장비 값 + 평균 마법서 + 부서지는 장비 x 장비 값)을 그 부위의 모든 마법서(이벤트 확률까지) 중
 *  가장 싼 길로 셈해 그 VALUE_RATE. 만드는 평균보다 늘 싸서 코인은 전체로 줄어들지만, +7 에서 +8 에 도전할지 지금 팔지 같은 고민이 생긴다 */
export const VALUE_RATE = 0.55;
export const VALUE_MAX = 300_000;
export function gearValue(g: Gear, lv: number, scrolls: Scroll[]): number {
  if (lv <= 0) return Math.max(1, Math.floor(g.price / 2));
  let cost = Infinity;
  for (const s of scrolls) {
    if (s.part !== g.part) continue;
    for (const rates of [s.rates, s.event]) {
      if (!rates) continue;
      const e = expectedTo((k) => rates[k] ?? 0, s.keep, 0, lv);
      if (e) cost = Math.min(cost, g.price + e.tries * scrollCost(g) + e.broken * g.price);
    }
  }
  if (!Number.isFinite(cost)) return Math.max(1, Math.floor(g.price / 2));
  return Math.min(VALUE_MAX, Math.max(Math.floor(g.price / 2), Math.floor(cost * VALUE_RATE)));
}

/** 장비마다 해금 값 (제작자 2026-11-04 '자동 강화도 무기별로 각각 다 해금하게, 해금 비용은 코인으로'): 자동 강화는 장비 값의 5배, 자동 구매는 10배 */
export const unlockCost = (g: Gear, kind: "auto" | "buy") => g.price * (kind === "auto" ? 5 : 10);

/** 강화도 k 의 수치 글: 무기 '8.4~58.8', 방어구 '방어 13' */
export function gearStat(g: Gear, k: number): string {
  if (g.part === "무기") {
    const b = g.table[Math.min(15, k)] ?? 0;
    const f = (v: number) => {
      const x = (v * (100 + b)) / 100;
      return Number.isInteger(x) ? String(x) : x.toFixed(1);
    };
    return `${f(g.min ?? 0)}~${f(g.max ?? 0)}`;
  }
  return `방어 ${g.table[Math.min(15, k)] ?? 0}`;
}
/** 강화도 k 의 평균 데미지(무기)나 방어도: 강해진 % 를 셀 때 */
export function gearPower(g: Gear, k: number): number {
  const b = g.table[Math.min(15, k)] ?? 0;
  return g.part === "무기" ? (((g.min ?? 0) + (g.max ?? 0)) / 2) * (1 + b / 100) : b;
}

/** 지금 들고 있는 장비 (캐릭터마다 이 기기에): 이름, 강화도, 부서졌나, 산 뒤 몇 번 눌렀나, 기록하지 않을 장비인가 */
export interface Held {
  name: string;
  lv: number;
  broken: boolean;
  tries: number;
  tainted: boolean;
  /** 이번 도전의 비용 (제작자 2026-11-19 '+8강까지 든 비용'): 이 장비를 +0 부터 올리며 쓴 코인(장비 값 + 마법서 1개씩), 마법서 수, 부서진 수.
   *  부서져 같은 장비를 다시 사면 이어서 센다. 이 칸이 생기기 전에 산 장비는 없다 (비용을 모른다) */
  cost?: number;
  used?: number;
  broke?: number;
  /** 강화도마다 마지막으로 닿은 때의 누적 [마법서, 부서진 수, 코인] (제작자 2026-11-20 '+7 가는 데 얼마, +8 까지 누적 얼마'). 0 은 산 때 */
  marks?: Record<number, [number, number, number]>;
}
/** 부서진 장비 수리 값: 다시 사는 값의 1/4 (제작자 2026-11-19 '가격은 수리가 훨씬 저렴하게'), 적어도 1 */
export const repairCost = (g: Gear) => Math.max(1, Math.round(g.price / 4));
/** 속성 부여 장신구·펫 추가 옵션 펫의 구매 값 (제작자 2026-11-20 '속성부여도 다음 거 구매비용', '펫도 구매비용'): 장신구는 요구 레벨로 방어구 값과 같게, 펫은 펫 도감 차례가 뒤일수록 (2 ~ 23) */
export const statPrice = (pet: boolean, i: number, lv: number) => (pet ? 2 + Math.round(Math.sqrt(i) * 1.2) : 1 + Math.round(lv ** 1.5 / 30));
/** 새로 산 장비의 비용: 부서진 같은 장비를 다시 사는 것이면 이어서, 아니면 처음부터 */
export function startRun(g: Gear, prev: Held | null): Pick<Held, "cost" | "used" | "broke" | "marks"> {
  const go = prev && prev.broken && prev.name === g.name && prev.cost !== undefined;
  return go
    ? { cost: prev.cost! + g.price, used: prev.used ?? 0, broke: prev.broke ?? 0, marks: { 0: [prev.used ?? 0, prev.broke ?? 0, prev.cost! + g.price] } }
    : { cost: g.price, used: 0, broke: 0, marks: { 0: [0, 0, g.price] } };
}
/** 영수증에 적는 강화도: 늘 성공하는 칸(무기 +6·방어구 +4 까지)은 빼고 (제작자 2026-11-20) */
export const RECEIPT_FROM: Record<Part, number> = { 무기: 7, 갑옷: 5 };
/** 닿은 강화도를 적는다: 부서져 다시 올라오면 그때 값으로 바꾼다 (제작자 2026-11-20 '파괴된 후에 또 7강 했는데 왜 그 기록으로 계속 뜨지') */
export const markRun = (h: Held, lv: number, run: Pick<Held, "cost" | "used" | "broke">): Held["marks"] =>
  run.cost === undefined ? h.marks : { ...(h.marks ?? {}), [lv]: [run.used ?? 0, run.broke ?? 0, run.cost] };
/** 수리로 강화도가 lv 로 내려가면: 그 위 기록은 지우고(다시 닿으면 새로 적는다) 수리한 자리를 적는다 */
export const markRepair = (h: Held, lv: number, cost: number): Held["marks"] => {
  if (h.cost === undefined) return h.marks;
  const m = Object.fromEntries(Object.entries(h.marks ?? {}).filter(([k]) => Number(k) < lv)) as NonNullable<Held["marks"]>;
  return { ...m, [lv]: [h.used ?? 0, h.broke ?? 0, cost] };
};
/** 강화도 lv 의 직전 구간 [마법서, 파괴, 코인]과 그 앞 강화도 (없으면 null) */
export function segmentOf(marks: NonNullable<Held["marks"]>, lv: number): { from: number; d: [number, number, number] } | null {
  const m = marks[lv];
  if (!m) return null;
  const prev = Object.keys(marks).map(Number).filter((k) => k < lv);
  if (!prev.length) return null;
  const from = Math.max(...prev);
  const p = marks[from];
  return { from, d: [m[0] - p[0], m[1] - p[1], m[2] - p[2]] };
}
/** 마법서 한 장(값 c 코인)을 쓴 뒤의 비용 (broke 면 부서진 수도) */
export const spendRun = (h: Held, broke = false, c = 1): Pick<Held, "cost" | "used" | "broke"> =>
  h.cost === undefined ? {} : { cost: h.cost + c, used: (h.used ?? 0) + 1, broke: (h.broke ?? 0) + (broke ? 1 : 0) };
const heldKey = (id: string, part: Part) => `sapphire.sim.held.${id}.${part}`;
export function loadHeld(id: string, part: Part): Held | null {
  try {
    const v = JSON.parse(localStorage.getItem(heldKey(id, part)) ?? "null");
    return v && typeof v.name === "string" ? (v as Held) : null;
  } catch {
    return null;
  }
}
export function saveHeld(id: string, part: Part, h: Held | null) {
  try {
    if (h) localStorage.setItem(heldKey(id, part), JSON.stringify(h));
    else localStorage.removeItem(heldKey(id, part));
  } catch {
    /* 저장이 안 되면 이번에 연 동안만 */
  }
}

/** 다음 장비를 사려면 앞 장비를 이만큼 올려야 한다 (제작자 2026-11-04 '직전 무기 8강 찍어야 다음 장비 구매 가능하게').
 *  방어구는 무기 +8 과 같은 어려움(성공 확률 30% · 10% 를 지나는 곳)인 +6 */
export const CLEAR_LV: Record<Part, number> = { 무기: 8, 갑옷: 6 };
/** 그 강화도까지 올린 장비 이름 (캐릭터마다 이 기기에) */
const clearKey = (id: string) => `sapphire.sim.cleared.${id}`;
export function loadCleared(id: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(clearKey(id)) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
export function saveCleared(id: string, s: Set<string>) {
  try {
    localStorage.setItem(clearKey(id), JSON.stringify([...s]));
  } catch {
    /* 저장이 안 되면 이번에 연 동안만 */
  }
}
/** 목록(레벨 순)에서 살 수 있는가: 맨 앞이거나, 바로 앞 장비를 올렸거나, 이미 올린 장비 */
export const canBuy = (list: Gear[], i: number, cleared: Set<string>) => i === 0 || cleared.has(list[i].name) || cleared.has(list[i - 1].name);
