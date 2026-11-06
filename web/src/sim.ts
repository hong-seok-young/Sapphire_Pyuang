// 확률 시뮬레이터 (개발중, 제작자 요청 2026-11-04 '강화 확률표 있지? 주장비나 방어구나 장신구 속성부여 시뮬레이터, 강화해 보면서 확률 체감하게',
// '강화 / 옵변 / 등등 확률 기반된 거 시뮬 다 해 볼 수 있게 모든 공식 정보 긁어모아서, 상자깡 같은 것도').
// 자료는 컴투스 공식 확률 표 106개 (data/odds.json, src/odds.ts). 표 모양으로 네 가지로 나눈다:
//   강화(마법서마다 목표 강화도의 성공 확률), 단계(장비 스탯 부여·펫 추가 옵션: 단계마다 +1·+2 성공 확률),
//   옵션(아이템마다 옵션 수치의 확률: 옵션 재설정, 과거의 유물, 이노티아의 축복, 조합 반지·의상, 코스튬 옵션), 상자(그 밖의 '획득 확률' 표 모두).
// 실패하면 어떻게 되는지는 공식 표에 없어서 위키 조합책 글을 따른다: 무기 +6·방어구 +4 넘게 강화하다 실패하면 파괴, 축복 마법서는 파괴를 막는다.
import type { Odds, OddsSection, OddsTable } from "./odds";
import { oddsName } from "./odds";

/** '91.466%' -> 0.91466, '-' 나 빈칸은 0 */
export function pct(s: string | undefined): number {
  const m = (s ?? "").replace(/,/g, "").match(/([\d.]+)\s*%/);
  return m ? Number(m[1]) / 100 : 0;
}

/** 확률대로 하나 고른다 (표의 확률 합이 반올림 때문에 100% 가 아니어서 합으로 나눈다) */
export function pick<T extends { p: number }>(list: T[]): T {
  const total = list.reduce((s, x) => s + x.p, 0);
  let r = Math.random() * total;
  for (const x of list) {
    r -= x.p;
    if (r < 0) return x;
  }
  return list[list.length - 1];
}

/** 확률로 보는 등급: 1% 이하 전설(금), 5% 이하 희귀(보라), 15% 이하 고급(파랑) */
export const tierOf = (p: number): "sr" | "r" | "u" | "n" => (p <= 0.01 ? "sr" : p <= 0.05 ? "r" : p <= 0.15 ? "u" : "n");

// ---------------------------------------------------------------- 강화

export type Part = "무기" | "갑옷";
export interface Scroll {
  id: string;
  /** 일반, 축복, 마력, 용사, 아바돈, 보호 */
  name: string;
  part: Part;
  /** 목표 강화도 -> 성공 확률 */
  rates: Record<number, number>;
  /** 이벤트 때 확률 (있는 마법서만) */
  event?: Record<number, number>;
  /** 실패해도 부서지지 않는다 (축복: 파괴를 막는다, 보호) */
  keep: boolean;
  key: string;
}
const SCROLLS: [name: string, weapon: string, armor: string, keep: boolean][] = [
  ["일반", "120101", "120102", false],
  ["축복", "120201", "120202", true],
  ["마력", "120301", "120302", false],
  ["용사", "120401", "120402", false],
  ["아바돈", "120501", "120502", false],
  ["보호", "120503", "120504", true],
];
const rateMap = (s: OddsSection): Record<number, number> => {
  const m: Record<number, number> = {};
  for (const r of s.r) {
    const lv = Number(r[0]);
    if (Number.isFinite(lv)) m[lv] = pct(r[1]);
  }
  return m;
};
export function scrollsOf(odds: Odds): Scroll[] {
  const T = new Map(odds.tables.map((t) => [t.key, t]));
  const out: Scroll[] = [];
  for (const [name, w, a, keep] of SCROLLS)
    for (const [part, key] of [["무기", w], ["갑옷", a]] as const) {
      const t = T.get(key);
      if (!t) continue;
      const normal = t.sections.find((s) => !s.t.includes("이벤트")) ?? t.sections[0];
      const ev = t.sections.find((s) => s.t.includes("이벤트"));
      out.push({ id: `${name}-${part}`, name, part, rates: rateMap(normal), event: ev ? rateMap(ev) : undefined, keep, key });
    }
  return out;
}

/** 무기 강화 가산값 (전사·레인저·무도가 공통, 공식 표 120600): 강화도 -> % */
export function weaponBonus(odds: Odds): Record<number, number> {
  const t = odds.tables.find((x) => x.key === "120600");
  const m: Record<number, number> = {};
  for (const r of t?.sections[0]?.r ?? []) m[Number(r[0])] = Number(r[1]);
  return m;
}

/**
 * +0 에서 목표까지 기대 마법서 수와 부서지는 장비 수 (실패하면 파괴되는 마법서는 +0 새 장비로 다시, 축복·보호는 그 자리에서 다시).
 * A_k = (A_{k-1} + 1) / p_k, D_k = (D_{k-1} + 1) / p_k - 1 (파괴), 지키면 A_k = A_{k-1} + 1 / p_k
 */
export function expectedTo(rate: (lv: number) => number, keep: boolean, from: number, to: number): { tries: number; broken: number; once: number } | null {
  let tries = 0;
  let broken = 0;
  let once = 1;
  for (let k = from + 1; k <= to; k++) {
    const p = rate(k);
    if (!(p > 0)) return null;
    once *= p;
    if (keep || p >= 1) tries += 1 / p;
    else {
      tries = (tries + 1) / p;
      broken = (broken + 1) / p - 1;
    }
  }
  return { tries, broken, once };
}

// ---------------------------------------------------------------- 단계 (스탯 부여, 펫 추가 옵션)

export interface Steps {
  key: string;
  name: string;
  /** 단계마다 +1, +2 성공 확률 (나머지는 실패: 단계 그대로) */
  steps: { a: number; b: number }[];
  max: number;
  /** 펫: 0단계에서 성공하면 옵션 종류를 정한다 */
  types?: { name: string; p: number }[];
  note: string;
}
export function stepsOf(odds: Odds): Steps[] {
  const T = new Map(odds.tables.map((t) => [t.key, t]));
  const out: Steps[] = [];
  const read = (key: string) => (T.get(key)?.sections[0]?.r ?? []).map((r) => ({ a: pct(r[1]), b: pct(r[2]) }));
  const stat = read("50100");
  if (stat.length) out.push({ key: "50100", name: "장비 스탯 부여", steps: stat, max: stat.length, note: "벨트 · 망토 · 목걸이 · 반지" });
  const pet = read("40100");
  if (pet.length) {
    const types = (T.get("40200")?.sections[0]?.r ?? []).map((r) => ({ name: PET_STAT[r[0]] ?? r[0], p: pct(r[1]) }));
    out.push({ key: "40100", name: "펫 추가 옵션", steps: pet, max: pet.length, types, note: "0단계에서 성공하면 옵션 종류가 정해져요" });
  }
  return out;
}
const PET_STAT: Record<string, string> = { STR: "힘", INT: "지능", DEX: "민첩", HP: "체력", MP: "마나" };

/** 지금 단계에서 끝 단계까지 기대 주문서 수 (실패하면 그대로) */
export function stepsExpected(st: Steps, from: number): number | null {
  const E: number[] = [];
  E[st.max] = 0;
  for (let s = st.max - 1; s >= from; s--) {
    const { a, b } = st.steps[s] ?? { a: 0, b: 0 };
    const up2 = Math.min(s + 2, st.max);
    if (a + b <= 0) return null;
    E[s] = (1 + a * E[s + 1] + b * E[up2]) / (a + b);
  }
  return E[from];
}

// ---------------------------------------------------------------- 옵션 (옵션 재설정, 과거의 유물, 이노티아의 축복, 조합 반지·의상, 코스튬)

export interface Dist {
  label: string;
  vals: { v: string; n: number; p: number }[];
}
export interface OptItem {
  name: string;
  opts: Dist[];
}
export interface OptSource {
  key: string;
  name: string;
  items: OptItem[];
}
/** 옵션 표가 있는 곳 (표 번호, 이름) */
const OPT_SOURCES: [string[], string][] = [
  [["130101", "130102"], "옵션 재설정"],
  [["130909", "130910", "130911", "130912", "130913", "130914", "130915"], "과거의 유물"],
  [["130205", "130206", "130207", "130208"], "이노티아의 축복"],
  [["90200", "90300", "90400", "90500"], "조합 반지 · 의상"],
  [["10302", "10402"], "코스튬 옵션"],
];
export const OPT_KEYS = new Set(OPT_SOURCES.flatMap(([k]) => k));
const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function optItemsOf(t: OddsTable): OptItem[] {
  const items = new Map<string, OptItem>();
  const add = (name: string, d: Dist) => {
    const it = items.get(name) ?? (items.set(name, { name, opts: [] }), items.get(name)!);
    it.opts.push(d);
  };
  for (const s of t.sections) {
    if (s.c[0]?.includes("옵션명")) {
      // [옵션명, 수치, 확률]: 옵션명마다 나눈다
      const by = new Map<string, Dist>();
      for (const r of s.r) {
        const d = by.get(r[0]) ?? (by.set(r[0], { label: r[0], vals: [] }), by.get(r[0])!);
        d.vals.push({ v: r[1], n: num(r[1]), p: pct(r[2]) });
      }
      for (const d of by.values()) add(s.t || oddsName(t), d);
      continue;
    }
    const vals = s.r.map((r) => ({ v: r[0], n: num(r[0]), p: pct(r[1]) }));
    const lvOpt = s.t.match(/^(.*?)\s*강화도 옵션 확률$/);
    if (lvOpt) {
      add(lvOpt[1], { label: "강화도", vals: vals.map((x) => ({ ...x, v: `+${x.v}` })) });
      continue;
    }
    const m = s.t.match(/^(.*?)\s+-\s+(.+)$/);
    if (m) add(m[1], { label: m[2], vals });
    else add(s.t, { label: "수치", vals });
  }
  return [...items.values()];
}
export function optionSources(odds: Odds): OptSource[] {
  const T = new Map(odds.tables.map((t) => [t.key, t]));
  return OPT_SOURCES.map(([keys, name]) => ({
    key: keys[0],
    name,
    items: keys.flatMap((k) => (T.get(k) ? optItemsOf(T.get(k)!) : [])),
  })).filter((s) => s.items.length);
}
/** 그 값 이상이 나올 확률 */
export const atLeast = (d: Dist, n: number) => d.vals.filter((x) => x.n >= n).reduce((s, x) => s + x.p, 0) / (d.vals.reduce((s, x) => s + x.p, 0) || 1);

// ---------------------------------------------------------------- 상자 (그 밖의 획득 확률 표 모두)

export interface BoxSection {
  title: string;
  items: { name: string; p: number }[];
}
export interface Box {
  key: string;
  cat: string;
  name: string;
  sections: BoxSection[];
  /** 공식 이벤트 글 그림 속 확률표에서 만든 상자면 그 글 번호와 올린 날 (server/officialOdds.ts) */
  post?: number;
  date?: string | null;
}
/** 뽑기로 보지 않는 표: 강화(120…), 단계(50100, 40100), 펫(40200, 40300), 보석 합성·세공(30101, 30201), 장비 수리(80101), 옵션 표. 다른 칸에서 따로 한다 */
const OWN = new Set(["50100", "40100", "40200", "40300", "30101", "30201", "80101"]);
const NOT_BOX = (t: OddsTable) => t.key.startsWith("120") || OWN.has(t.key) || OPT_KEYS.has(t.key);
const CATS: Record<string, string> = { 외형: "외형 · 염색", 염색: "외형 · 염색", "펫 강화": "기타", 아이템: "기타", "장비 수리": "기타", 조합책: "기타", 보석: "보석" };
export const BOX_CATS = ["가챠샵", "랜덤상자", "랜덤 코스튬", "이벤트", "이벤트 공지", "외형 · 염색", "기타"];

const lastIndex = <T>(xs: T[], f: (x: T) => boolean) => {
  for (let i = xs.length - 1; i >= 0; i--) if (f(xs[i])) return i;
  return -1;
};
function boxSections(t: OddsTable): BoxSection[] {
  const out: BoxSection[] = [];
  for (const s of t.sections) {
    const pi = lastIndex(s.c, (c) => c.includes("확률"));
    // 장비 수리: 줄마다(무기, 방어구) 칸이 강화 단계 확률 -> 줄을 한 묶음으로
    if (pi < 0 && s.c.slice(1).every((c) => /강화단계/.test(c))) {
      for (const r of s.r) out.push({ title: `${r[0]} 수리`, items: s.c.slice(1).map((c, i) => ({ name: `+${c.replace(/\D/g, "")}`, p: pct(r[i + 1]) })).filter((x) => x.p > 0) });
      continue;
    }
    if (pi < 0) continue;
    // 보석 합성: 합성 단계마다 나눈다
    if (s.c[0].includes("단계") && s.c.includes("합성 결과")) {
      const ri = s.c.indexOf("합성 결과");
      const by = new Map<string, BoxSection>();
      for (const r of s.r) {
        const sec = by.get(r[0]) ?? (by.set(r[0], { title: `${r[0]} 보석 ${r[1]}개 합성`, items: [] }), by.get(r[0])!);
        sec.items.push({ name: r[ri], p: pct(r[pi]) });
      }
      out.push(...by.values());
      continue;
    }
    const ci = s.c.indexOf("개수");
    const items = s.r
      .map((r) => {
        const label = r.filter((_, i) => i !== pi && i !== ci).join(" ");
        return { name: ci >= 0 && r[ci] && r[ci] !== "1" ? `${label} x${r[ci]}` : label, p: pct(r[pi]) };
      })
      .filter((x) => x.p > 0);
    if (items.length) out.push({ title: s.t, items });
  }
  return out;
}
export function boxesOf(odds: Odds): Box[] {
  return odds.tables
    .filter((t) => !NOT_BOX(t))
    .map((t) => ({ key: t.key, cat: CATS[t.path[0]] ?? t.path[0], name: oddsName(t), sections: boxSections(t) }))
    .filter((b) => b.sections.length);
}

/** 표 하나를 뽑기 상자로 (보석 세공처럼 다른 칸에서 그 표만 열 때) */
export function boxOf(odds: Odds, key: string): Box | null {
  const t = odds.tables.find((x) => x.key === key);
  if (!t) return null;
  const sections = boxSections(t);
  return sections.length ? { key: t.key, cat: t.path[0], name: oddsName(t), sections } : null;
}

// ---------------------------------------------------------------- 보석 합성 (30101): 같은 단계 3개 -> 그 단계·한 단계 위·두 단계 위

export const GEM_NAMES = ["", "흑요석", "자수정", "사파이어", "아쿠아마린"];
export function gemSynth(odds: Odds): Record<number, { to: number; p: number }[]> {
  const t = odds.tables.find((x) => x.key === "30101");
  const out: Record<number, { to: number; p: number }[]> = {};
  for (const r of t?.sections[0]?.r ?? []) {
    const from = Number(r[0].replace(/\D/g, ""));
    const to = Number((r[3] ?? "").replace(/\D/g, "").slice(0, 1));
    if (from && to) (out[from] ??= []).push({ to, p: pct(r[2]) });
  }
  return out;
}

// ---------------------------------------------------------------- 장비 수리 (80101): 수리하면 강화도가 다시 정해진다

export function repairItems(odds: Odds): OptItem[] {
  const s = odds.tables.find((x) => x.key === "80101")?.sections[0];
  if (!s) return [];
  return s.r.map((r) => ({
    name: `${r[0]} 수리`,
    opts: [{ label: "강화도", vals: s.c.slice(1).map((c, i) => ({ v: `+${c.replace(/\D/g, "")}`, n: Number(c.replace(/\D/g, "")), p: pct(r[i + 1]) })).filter((x) => x.p > 0) }],
  }));
}

/** 옵션 표가 있는 아이템 찾기: '백색레이피어' -> 'Lv.30~43 백색레이피어' (같은 앞말 먼저), 과거의 유물 '백색레이피어' */
export function optionFor(sources: OptSource[], name: string, prefix: string): OptItem | null {
  const bare = (s: string) => s.replace(/^Lv\.\S+\s+/, "").replace(/\s+/g, "");
  const all = sources.flatMap((s) => s.items);
  const same = all.filter((x) => bare(x.name) === bare(name));
  return same.find((x) => prefix && x.name.startsWith(prefix)) ?? same.find((x) => !/^Lv\./.test(x.name)) ?? same[0] ?? null;
}

/** 뽑은 것이 또 다른 상자면 그 상자 ('마법의유물' -> 과거의 유물 · 획득 확률 (마법의유물)) */
export function boxFor(boxes: Box[], name: string, self: string): Box | null {
  const n = name.replace(/\s*x\d+$/, "").replace(/\s+/g, "");
  if (n.length < 3) return null;
  return boxes.find((b) => b.key !== self && b.sections.some((s) => s.title.replace(/\s+/g, "").includes(`(${n})`) || s.title.replace(/\s+/g, "") === n)) ?? null;
}
