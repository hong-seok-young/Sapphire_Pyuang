// 도감 계산기 시세 비교 (제작자 요청 2026-11-11: '골드로 직접 장비를 구매하는 게 싼가 vs 스탬프로 등록하는 게 싼가',
// '아바돈 이벤트 기준으로 채울 때 vs 이벤트 아닐 때'). 규칙은 비공개 자료 `제공/도감_시세.md`, 값은 build_dex.py 가 dex.json 의 price 로 붙인다.
// - 도감용 장비는 옵션 무시, 같은 장비 중 가장 싼 거래소 매물.
// - 갑옷류(갑옷·투구·장갑·신발·보조 장비)는 +4, 무기는 +6 까지 100% 성공 (공식 확률 120101·120102): 그 안에서는 한 단계 = 마법서 1장.
// - 안전 단계 다음(갑옷 +5, 무기 +7) = (장비 + 마법서 N장) × 2, 그다음(갑옷 +6, 무기 +8) = 그 값 × 2.5. 더 위는 규칙이 없어 완성품 매물만.
// - 단계마다 그 강화 완성품 매물이 계산값보다 싸면 매물 값 (제작자 확인 2026-11-11 '이게 맞지'). 그래서 +3 매물에 마법서를 더하는 길도 저절로 견준다.
// - 마법서 등급은 장비 요구 레벨로: D 10 미만 · C 20 · B 30 · A 40 · S 50 미만 · 그 위 SS (해외 위키 마법서 표).
// - 스탬프 = 칸의 대체 스탬프 장수 × 1장 값. 아바돈 스탬프 1장 = 일반 50장 (제작자, 평소에는 자판기에서 일반 50장으로 바꾼다).
import type { Me } from "./auth";
import type { DexGearPrice, DexItem, DexPrice } from "./data";

export type Mode = "normal" | "event";
export const MODES: { key: Mode; label: string }[] = [
  { key: "normal", label: "평소" },
  { key: "event", label: "아바돈 이벤트" },
];
type Kind = "무기" | "갑옷";
const SAFE: Record<Kind, number> = { 무기: 6, 갑옷: 4 };
export const STAMP_GRADES = ["S", "A", "B"] as const;

/** 위키·거래소 이름을 잇는 열쇠: 앞의 +N, 띄어쓰기, [ ] ( ) 를 뺀다 (build_dex.py 의 key 와 같다) */
export const gearKey = (name: string) => name.replace(/^\+\d+\s*/, "").replace(/\[[^\]]*\]|\([^)]*\)|\s/g, "");
export const scrollGrade = (lv: number) => (lv < 10 ? "D" : lv < 20 ? "C" : lv < 30 ? "B" : lv < 40 ? "A" : lv < 50 ? "S" : "SS");
const kindOf = (k: string | null): Kind | null => (k === "무기" ? "무기" : k === "갑옷류" ? "갑옷" : null);

/** 화면에서 손으로 고친 값 (이 기기에 계정별로, localStorage sapphire.dex.price.<아이디>):
 *  scroll['무기 A'] = 마법서 1장 골드, stamp['normal A'] = 스탬프 1장 플래티넘, plat = 플래티넘 1 의 골드 */
export interface PriceSet { scroll: Record<string, number>; stamp: Record<string, number>; plat?: number }
const setKey = (me: Me) => `sapphire.dex.price.${me.id}`;
export function readPriceSet(me: Me): PriceSet {
  try {
    const v = JSON.parse(localStorage.getItem(setKey(me)) ?? "{}") as Partial<PriceSet>;
    return { scroll: v.scroll ?? {}, stamp: v.stamp ?? {}, plat: v.plat };
  } catch {
    return { scroll: {}, stamp: {} };
  }
}
export function writePriceSet(me: Me, v: PriceSet) {
  try {
    localStorage.setItem(setKey(me), JSON.stringify(v));
  } catch {
    /* 이번에 연 동안만 */
  }
}

export const scrollName = (kind: Kind, grade: string) => `${kind} ${grade}`;
/** '무기 A' -> '무기마법서(A)' (게임 이름 '무기마법서(A등급)' 처럼) */
export const scrollLabel = (name: string) => name.replace(" ", "마법서(") + ")";
export function scrollPrice(price: DexPrice, set: PriceSet, kind: Kind, grade: string): number | null {
  return set.scroll[scrollName(kind, grade)] ?? price.scroll?.[kind]?.[grade] ?? null;
}
export function stampPlat(price: DexPrice, set: PriceSet, mode: Mode, grade: string): number | null {
  return set.stamp[`${mode} ${grade}`] ?? price.stamp?.[mode]?.[grade] ?? null;
}
export const platGold = (price: DexPrice, set: PriceSet) => set.plat ?? price.stamp?.platGold ?? 700;

/** 강화 한 칸을 골드로 채우는 가장 싼 길 (장비 1개): base = 산 매물의 강화, scrolls = 더한 마법서, mult = ×2 · ×2.5 */
export interface GoldWay { v: number; base: number; baseV: number; scrolls: number; mult: string[] }
export function goldWay(g: DexGearPrice, plus: number, scroll: number | null): GoldWay | null {
  const kind = kindOf(g.k);
  const safe = kind ? SAFE[kind] : null;
  let prev: GoldWay | null = null;
  for (let t = 0; t <= plus; t++) {
    const l = g.p[String(t)];
    let best: GoldWay | null = l != null ? { v: l, base: t, baseV: l, scrolls: 0, mult: [] } : null;
    let calc: GoldWay | null = null;
    const p = prev as GoldWay | null;
    if (t > 0 && p && safe != null && scroll != null) {
      if (t <= safe) calc = { ...p, v: p.v + scroll, scrolls: p.scrolls + 1 };
      else if (t === safe + 1) calc = { ...p, v: (p.v + scroll) * 2, scrolls: p.scrolls + 1, mult: [...p.mult, "×2"] };
      else if (t === safe + 2) calc = { ...p, v: p.v * 2.5, mult: [...p.mult, "×2.5"] };
    }
    if (calc && (!best || calc.v < best.v)) best = calc;
    prev = best;
  }
  return prev;
}

export function fmtGold(v: number): string {
  if (v >= 1e8) return `${Math.round(v / 1e7) / 10}억`;
  if (v >= 1e4) return `${Math.round(v / 1e3) / 10}만`;
  return Math.round(v).toLocaleString("ko-KR");
}
export function wayText(w: GoldWay, scroll: string | null): string {
  const base = `${w.base ? "+" + w.base : "노강"} 매물 ${fmtGold(w.baseV)}`;
  const core = w.scrolls ? `${base} + ${scroll ? scrollLabel(scroll) : "마법서"} ${w.scrolls}장` : base;
  return w.mult.length ? (w.scrolls ? `(${core}) ${w.mult.join(" ")}` : `${core} ${w.mult.join(" ")}`) : core;
}

/** 한 칸의 값: 골드로(장비 × 개수), 스탬프로(평소 · 이벤트). missing = 이 마법서 값이 있으면 골드 값이 나온다 */
export interface SlotCost { gold: number | null; way: GoldWay | null; missing: string | null; scroll: string | null; stamp: Record<Mode, number | null> }
export function slotCost(it: DexItem, price: DexPrice, set: PriceSet): SlotCost {
  const stamp = { normal: stampGold(it, price, set, "normal"), event: stampGold(it, price, set, "event") };
  const g = it.name ? price.gear[gearKey(it.name)] : undefined;
  if (!g) return { gold: null, way: null, missing: null, scroll: null, stamp };
  const kind = kindOf(g.k);
  const grade = g.lv != null ? scrollGrade(g.lv) : null;
  const sname = kind && grade ? scrollName(kind, grade) : null;
  const sp = kind && grade ? scrollPrice(price, set, kind, grade) : null;
  const plus = it.plus ?? 0;
  const way = goldWay(g, plus, sp);
  // 마법서 값이 없어서 못 셈: 아무 값이나 넣으면 나오는지 본다
  const missing = !way && sp == null && sname && goldWay(g, plus, 1) ? sname : null;
  // 강화 칸이면 마법서 값으로 더 싸질 수 있다 (화면에 그 등급 마법서 값 칸을 보인다)
  return { gold: way ? way.v * it.n : null, way, missing, scroll: plus > 0 ? sname : null, stamp };
}
function stampGold(it: DexItem, price: DexPrice, set: PriceSet, mode: Mode): number | null {
  if (!it.sg || it.sg === "불가" || !it.sn || !price.stamp) return null;
  const ab = it.sg.startsWith("아바돈");
  const plat = stampPlat(price, set, mode, it.sg.replace("아바돈", ""));
  if (plat == null) return null;
  return plat * (ab ? price.stamp.abaddon : 1) * it.sn * it.n * platGold(price, set);
}
/** 싼 쪽 (같으면 골드) */
export function pickWay(c: SlotCost, mode: Mode): { by: "gold" | "stamp"; v: number } | null {
  const s = c.stamp[mode];
  if (c.gold == null && s == null) return null;
  if (s == null || (c.gold != null && c.gold <= s)) return { by: "gold", v: c.gold! };
  return { by: "stamp", v: s };
}

/** 장비 칸인지 (강화·장비스탬프가 있거나 시세가 있는 장비). 재료(쿠이증표 등)는 값을 세지 않는다 */
export const isCostSlot = (it: DexItem, price: DexPrice) => !!it.plus || (!!it.sg && it.sg !== "불가") || (!!it.name && !!price.gear[gearKey(it.name)]);

export interface Totals {
  slots: number;
  none: number; // 골드·스탬프 둘 다 값이 없는 칸
  missing: Map<string, number>; // 마법서 값이 없어 골드를 못 센 칸 (마법서 이름 -> 칸 수)
  scrolls: Map<string, number>; // 강화 칸에 쓰이는 마법서 (마법서 이름 -> 칸 수)
  by: Record<Mode, { sum: number; gold: number; stamp: number }>;
}
export function totals(items: DexItem[], price: DexPrice, set: PriceSet): Totals {
  const t: Totals = { slots: 0, none: 0, missing: new Map(), scrolls: new Map(), by: { normal: { sum: 0, gold: 0, stamp: 0 }, event: { sum: 0, gold: 0, stamp: 0 } } };
  for (const it of items) {
    if (!isCostSlot(it, price)) continue;
    t.slots++;
    const c = slotCost(it, price, set);
    if (c.missing) t.missing.set(c.missing, (t.missing.get(c.missing) ?? 0) + 1);
    if (c.scroll) t.scrolls.set(c.scroll, (t.scrolls.get(c.scroll) ?? 0) + 1);
    let any = false;
    for (const m of ["normal", "event"] as Mode[]) {
      const w = pickWay(c, m);
      if (!w) continue;
      any = true;
      t.by[m].sum += w.v;
      t.by[m][w.by]++;
    }
    if (!any) t.none++;
  }
  return t;
}

/** 아바돈 장비 스탬프 판매 중인지 (끝나는 날 아침 점검 전까지, 한국 시간) */
export function saleOn(price: DexPrice, now = new Date()): boolean {
  if (!price.sale) return false;
  const kst = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  return kst >= price.sale.start && kst <= price.sale.end;
}
