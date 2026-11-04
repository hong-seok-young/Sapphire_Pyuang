// 확률 시뮬레이터의 실제 장비 (제작자 요청 2026-11-04 '강화 대상 장비도 강한 순서가 있으니 그 재화로 노작을 사서 강화', '실제 장비들 넣어서').
// 장비: 위키 장비 표(equipment.json)의 무기(직업마다)와 방어구(갑옷·투구·장갑·신발). '+7로크의검[40~49LV]' 처럼 이미 강화된 이벤트 장비와 거래불가 시작 장비는 뺀다.
// 강화 수치: 공식 확률 표의 강화 효과 (120600 전사·레인저·무도가 무기 가산값, 120700 마법사 무기마다, 120900 방어구 기본 방어도마다).
// 마법사 무기는 120700 에 있는 것만 (가산값을 모르면 강화한 데미지를 셀 수 없다).
// 값: 레벨이 높을수록 비싸다 (강한 장비일수록 부서지면 아프다). 장비 값은 행운 코인으로 낸다.
import type { Odds } from "./odds";
import type { Wiki, Pic } from "./types";
import type { Part } from "./sim";

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

/** 상점에서 뺀 장비 (제작자 2026-11-04 '철검 회색레이피어 빼') */
const HIDDEN = new Set(["철검", "회색레이피어"]);

const num = (s: string | undefined) => {
  const v = Number(String(s ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(v) ? v : NaN;
};
const squash = (s: string) => s.replace(/\s/g, "");

/** 노작 값 (코인): 무기 Lv.10 10 · Lv.27 28 · Lv.40 47 · Lv.52 67, 방어구는 그 절반쯤 */
export const gearPrice = (part: Part, lv: number) => (part === "무기" ? 5 + Math.round(lv ** 1.5 / 6) : 3 + Math.round(lv ** 1.5 / 10));

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
      if (!name || /^\+|\[/.test(name) || seen.has(name) || HIDDEN.has(name)) continue;
      if ((cell("옵션") ?? "").includes("거래불가")) continue;
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
}
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
