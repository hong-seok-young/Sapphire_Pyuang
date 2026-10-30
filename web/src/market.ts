// 사파이어 중개인 (서버: functions/api/market, server/market.ts). 길드원끼리 파는 물건 게시판.
// 실제 거래는 게임 안에서 한다. 이 화면은 무엇을 얼마에 파는지, 누가 사고 싶은지만 모은다.
import { api } from "./auth";
import type { Item, Wiki } from "./types";

/** 게임 거래소의 종류 (코스튬은 하나로 묶었다). 서버 server/market.ts 와 같다 */
export const CATEGORIES = [
  "갑옷", "주장비", "투구", "보조장비", "장갑", "신발", "벨트", "망토", "목걸이", "반지",
  "가방", "소모품", "인챈트", "기타", "스킬북", "펫", "코스튬",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** 속성부여: 힘, 민첩, 지능은 1~3, 체력, 마나는 10/20/30 (게임 아이템 정보창의 주황 글씨) */
export type Enchant = "str" | "dex" | "int" | "hp" | "mp";
export const ENCHANTS: { key: Enchant; name: string; values: number[] }[] = [
  { key: "str", name: "힘", values: [1, 2, 3] },
  { key: "dex", name: "민첩", values: [1, 2, 3] },
  { key: "int", name: "지능", values: [1, 2, 3] },
  { key: "hp", name: "체력", values: [10, 20, 30] },
  { key: "mp", name: "마나", values: [10, 20, 30] },
];
/** 강화(+N)만 되는 종류와 속성부여만 되는 종류 (게임 규칙, 제작자가 알려 줌). 나머지는 둘 다 안 된다. 서버 server/market.ts 와 같다 */
export const ENHANCE_CATEGORIES: Category[] = ["갑옷", "주장비", "투구", "보조장비", "장갑", "신발"];
export const ENCHANT_CATEGORIES: Category[] = ["벨트", "망토", "목걸이", "반지"];
export const ENCHANT_NAME = Object.fromEntries(ENCHANTS.map((e) => [e.key, e.name])) as Record<Enchant, string>;
export const MAX_ENHANCE = 20;
export const MAX_QTY = 9999;
export const MAX_PRICE = 99_999_999_999;
export const MAX_NOTE = 60;

/** 게임 거래소 스샷에서 자른 그림 (자료/scripts/make_market_marks.py) */
export const MARKET_PIC = "/data/market/";

/** 종류 그림 파일 (주소에 한글을 안 쓰려고 영문. make_market_marks.py 와 같다) */
const CATEGORY_FILE: Record<Category | "전체", string> = {
  전체: "all", 갑옷: "armor", 주장비: "weapon", 투구: "helmet", 보조장비: "sub", 장갑: "gloves", 신발: "shoes", 벨트: "belt",
  망토: "cape", 목걸이: "necklace", 반지: "ring", 가방: "bag", 소모품: "potion", 인챈트: "enchant", 기타: "etc",
  스킬북: "skillbook", 펫: "pet", 코스튬: "costume",
};
export const categoryPic = (c: Category | "전체") => `${MARKET_PIC}cat_${CATEGORY_FILE[c]}.png`;

/** 판 사람이 적은 옵션 하나 (예: 명중 5, 이동속도 3%) */
export interface ListingOption {
  name: string;
  value: number;
  unit: "" | "%";
}

export interface Wanter {
  id: string;
  note: string | null;
  at: number;
}

export interface Listing {
  id: number;
  seller: string;
  item: string;
  category: Category;
  enhance: number;
  enchant: Enchant | null;
  enchantValue: number | null;
  qty: number;
  price: number;
  note: string | null;
  /** 옵션이 범위에서 뜨는 아이템이면 판 사람이 적은 값 */
  options: ListingOption[] | null;
  status: "selling" | "sold";
  createdAt: number;
  updatedAt: number;
  wants: number;
  wanted: boolean;
  /** 내 글에만 온다: '살래요'를 누른 사람 */
  wanters?: Wanter[];
}

export interface ListingInput {
  item: string;
  category: Category;
  enhance: number;
  enchant: Enchant | null;
  enchantValue: number | null;
  qty: number;
  price: number;
  note: string | null;
  options: ListingOption[] | null;
}

export const fetchMarket = () => api<{ listings: Listing[] }>("/api/market").then((r) => r.listings);
export const createListing = (input: ListingInput) => api<Listing>("/api/market", "POST", input);
export const updateListing = (id: number, change: { status?: "selling" | "sold"; price?: number; note?: string | null }) =>
  api<Omit<Listing, "wants" | "wanted" | "wanters">>(`/api/market/${id}`, "PATCH", change);
export const deleteListing = (id: number) => api<{ ok: boolean }>(`/api/market/${id}`, "DELETE");
export const wantListing = (id: number, note: string | null) =>
  api<{ wants: number; wanted: boolean }>(`/api/market/${id}/want`, "PUT", { note });
export const unwantListing = (id: number) => api<{ wants: number; wanted: boolean }>(`/api/market/${id}/want`, "DELETE");

/** 3800000 -> "3,800,000" */
export const goldText = (n: number) => n.toLocaleString("ko-KR");

/** 3800000 -> "380만", 125000000 -> "1억 2500만" (가격 적을 때 읽기 쉽게) */
export function goldWords(n: number): string {
  if (!n) return "";
  const eok = Math.floor(n / 100_000_000);
  const man = Math.floor((n % 100_000_000) / 10_000);
  const rest = n % 10_000;
  return [eok ? `${eok}억` : "", man ? `${man}만` : "", rest ? `${rest}` : ""].filter(Boolean).join(" ");
}

/** "+6 숙련마법사옷" 처럼 강화를 붙인 이름 */
export const listingName = (l: { item: string; enhance: number }) => (l.enhance > 0 ? `+${l.enhance}` : "") + l.item;

/** "힘 3", "체력 20" */
export const enchantText = (l: { enchant: Enchant | null; enchantValue: number | null }) =>
  l.enchant && l.enchantValue ? `${ENCHANT_NAME[l.enchant]} ${l.enchantValue}` : "";

/** 위키 장비 부위 -> 거래소 종류 */
const SLOT_CATEGORY: Record<string, Category> = {
  "전사 무기": "주장비", "레인저 무기": "주장비", "마법사 무기": "주장비", "무도가 무기": "주장비",
  "보조 장비": "보조장비", 투구: "투구", 갑옷: "갑옷", 장갑: "장갑", 신발: "신발", 망토: "망토", 벨트: "벨트",
  목걸이: "목걸이", 반지: "반지",
};

/** 위키 아이템 (이름의 띄어쓰기는 상관없이) */
export function wikiItem(wiki: Wiki, name: string): Item | undefined {
  return wiki.items[name] ?? wiki.items[name.replace(/\s+/g, "")];
}

/** 위키가 아는 장비면 그 종류 */
export function categoryOf(item: Item | undefined): Category | undefined {
  const slot = item?.equip[0]?.slot;
  return slot ? SLOT_CATEGORY[slot] : undefined;
}

/** 범위에서 뜨는 옵션 (헌터보우의 명중 0~11, 워소드의 힘 0 & 2~10 처럼 '0 아니면 2~10') */
export interface OptionRoll {
  name: string;
  /** 뜰 수 있는 값들: [작은 값, 큰 값] 묶음 */
  ranges: [number, number][];
  unit: "" | "%";
  /** 위키에 ? 가 붙은 값 (정확하지 않음) */
  unsure: boolean;
}

/** 위키 '옵션' 칸을 나눈 것 */
export interface ItemOptions {
  /** 판 사람이 뜬 값을 적어야 하는 옵션 */
  rolls: OptionRoll[];
  /** 값이 정해진 옵션 ("크리티컬 1", "데미지 증가 +10%") */
  fixed: string[];
  /** 세트 효과 ("[2세트] 체력 35") */
  sets: string[];
  /** 강화불가, 거래불가, 기간제 같은 안내 */
  notes: string[];
}

/** 위키 '옵션' 칸 ("명중 0~11 / 민첩 0~8", "힘 0 & 3~11", "크리티컬 1 / 강화불가") 을 나눈다 */
export function parseItemOptions(text: string | undefined): ItemOptions {
  const out: ItemOptions = { rolls: [], fixed: [], sets: [], notes: [] };
  const raw = (text ?? "").trim();
  if (!raw || raw === "-") return out;
  let inSet = false;
  for (const piece of raw.split("/").map((p) => p.trim()).filter(Boolean)) {
    if (piece.includes("세트]")) inSet = true;
    if (inSet) {
      // "[2세트]" 다음 조각은 그 세트의 내용
      const last = out.sets.length - 1;
      if (last >= 0 && /^\[\d+세트\]$/.test(out.sets[last])) out.sets[last] += " " + piece;
      else out.sets.push(piece);
      continue;
    }
    const unsure = piece.endsWith("?");
    const part = piece.replace(/\?+$/, "").trim();
    const m = /^([^\d+-]*[^\d\s+-])\s*([+-]?\d.*)$/.exec(part);
    if (!m) {
      if (!/^\d+$/.test(part)) out.notes.push(part);
      continue;
    }
    const name = m[1].trim();
    const spec = m[2].replace(/\s+/g, "");
    const ranges: [number, number][] = [];
    for (const alt of spec.replace(/%/g, "").split("&")) {
      const r = /^([+-]?\d+(?:\.\d+)?)(?:[~-](\d+(?:\.\d+)?))?$/.exec(alt); // 0~11, 0-3 둘 다
      if (!r) {
        ranges.length = 0;
        break;
      }
      ranges.push([Number(r[1]), Number(r[2] ?? r[1])]);
    }
    if (!ranges.length) out.notes.push(part);
    else if (ranges.length === 1 && ranges[0][0] === ranges[0][1]) out.fixed.push(`${name} ${m[2].trim()}`);
    else out.rolls.push({ name, ranges, unit: spec.includes("%") ? "%" : "", unsure });
  }
  return out;
}

/** "0~11", "0 또는 3~11", "5~8%" */
export function rollHint(r: OptionRoll): string {
  return r.ranges.map(([a, b]) => (a === b ? `${a}` : `${a}~${b}`)).join(" 또는 ") + r.unit;
}

/** 위키 범위 안의 값인지 (0 은 언제나 될 수 있다) */
export function inRoll(r: OptionRoll, v: number): boolean {
  return v === 0 || r.ranges.some(([a, b]) => v >= a && v <= b);
}

/** 위키 장비 정보에서 정보창에 보일 것 (요구 레벨, 공격/방어, 직업, 옵션) */
export function itemFacts(item: Item | undefined): { level?: string; stats: string[]; job?: string; options: ItemOptions } {
  const info = item?.equip[0]?.info;
  if (!info) return { stats: [], options: parseItemOptions(undefined) };
  const stats = ["공격", "속도", "방어력", "막기", "정밀", "마법 / 데미지"]
    .filter((k) => info[k])
    .map((k) => `${k} ${info[k]}`);
  return { level: info["레벨제한"] || undefined, stats, job: info["직업"] || undefined, options: parseItemOptions(info["옵션"]) };
}

/** "방금", "3시간 전", "2일 전" */
export function ago(t: number, now = Date.now()): string {
  const m = Math.floor((now - t) / 60_000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}
