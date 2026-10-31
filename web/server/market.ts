// 사파이어 중개인: 길드원끼리 파는 물건을 올리고, 사고 싶은 사람이 '살래요'를 누르는 게시판.
// 게임 밖의 약속일 뿐이고 실제 거래는 게임 안에서 한다 (게임에 아무것도 보내지 않는다. CLAUDE.md 게임 안전 규칙).
// 화면 쪽 같은 목록: web/src/market.ts

/** 게임 거래소의 종류 (코스튬은 하나로 묶었다) */
export const CATEGORIES = [
  "갑옷", "주장비", "투구", "보조장비", "장갑", "신발", "벨트", "망토", "목걸이", "반지",
  "가방", "소모품", "인챈트", "기타", "스킬북", "펫", "코스튬",
];
/** 속성부여: 힘, 민첩, 지능은 1~3, 체력, 마나는 10, 20, 30 */
export const ENCHANT_VALUES: Record<string, number[]> = {
  str: [1, 2, 3], dex: [1, 2, 3], int: [1, 2, 3], hp: [10, 20, 30], mp: [10, 20, 30],
};
/** 강화(+N)만 되는 종류와 속성부여만 되는 종류 (게임 규칙, 제작자가 알려 줌). 나머지는 둘 다 안 된다. 화면 src/market.ts 와 같다 */
export const ENHANCE_CATEGORIES = ["갑옷", "주장비", "투구", "보조장비", "장갑", "신발"];
export const ENCHANT_CATEGORIES = ["벨트", "망토", "목걸이", "반지"];
export const MAX_ENHANCE = 20;
export const MAX_QTY = 9999;
export const MAX_PRICE = 99_999_999_999;
export const MAX_NOTE = 60;
/** 한 사람이 한꺼번에 팔 수 있는 수 (게임 거래소처럼 20) */
export const MAX_SELLING = 20;
/** 거래 완료한 글은 이만큼 지나면 지운다 */
export const KEEP_SOLD_MS = 30 * 86_400_000;
/** 경매 시간 (시간 단위): 12시간, 1일, 2일, 3일 */
export const AUCTION_HOURS = [12, 24, 48, 72];
/** 골드 시세(1만 원에 몇 만 골드)를 모를 때 쓰는 값 (제작자가 알려 준 요즘 시세) */
export const USUAL_GOLD_RATE = 75;
/** 옵션이 범위에서 뜨는 아이템(헌터보우: 명중 0~11 / 민첩 0~8)은 판 사람이 뜬 값을 적는다. 한 글에 이만큼까지 */
export const MAX_OPTIONS = 8;

/** 판 사람이 적은 옵션 하나 (예: 명중 5, 이동속도 3%) */
export interface ListingOption {
  name: string;
  value: number;
  unit: "" | "%";
}

export interface ListingInput {
  item: string;
  category: string;
  enhance: number;
  enchant: string | null;
  enchantValue: number | null;
  qty: number;
  price: number;
  note: string | null;
  options: ListingOption[] | null;
  /** sale 바로 판매 (흥정은 '살래요'에 적는다) | auction 경매 (price 가 시작가) */
  mode: "sale" | "auction";
  /** 경매면 몇 시간 동안 */
  hours: number | null;
}

const ITEM_NAME = /^[\p{L}\p{N} ()[\]:+\-.,'·~!&]{1,30}$/u;

export function validPrice(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_PRICE;
}

/** 한마디: 비우면 null, 너무 길거나 글자가 아니면 undefined */
export function readNote(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return null;
  return t.length <= MAX_NOTE ? t : undefined;
}

const OPTION_NAME = /^[\p{L}& ]{1,16}$/u;

/** 옵션 값들: 안 보냈으면 null, 맞지 않으면 이유(문자열) */
export function readOptions(v: unknown): ListingOption[] | null | string {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length > MAX_OPTIONS) return "옵션이 맞지 않아요";
  const out: ListingOption[] = [];
  for (const o of v) {
    if (!o || typeof o !== "object") return "옵션이 맞지 않아요";
    const { name, value, unit } = o as Record<string, unknown>;
    if (typeof name !== "string" || !OPTION_NAME.test(name.trim())) return "옵션 이름이 맞지 않아요";
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 99_999) return "옵션 값은 0 이상의 정수로 적어 주세요";
    if (unit !== undefined && unit !== "" && unit !== "%") return "옵션이 맞지 않아요";
    out.push({ name: name.trim(), value: value as number, unit: unit === "%" ? "%" : "" });
  }
  return out.length ? out : null;
}

/** 화면이 보낸 판매 글을 검사한다. 맞으면 ListingInput, 아니면 이유 */
export function readListing(b: Record<string, unknown>): ListingInput | string {
  const item = typeof b.item === "string" ? b.item.trim().replace(/\s+/g, " ") : "";
  if (!ITEM_NAME.test(item)) return "아이템 이름을 30자까지 적어 주세요";
  const category = b.category;
  if (typeof category !== "string" || !CATEGORIES.includes(category)) return "종류를 골라 주세요";
  const enhance = b.enhance ?? 0;
  if (!Number.isInteger(enhance) || (enhance as number) < 0 || (enhance as number) > MAX_ENHANCE) return `강화는 0~${MAX_ENHANCE} 로 적어 주세요`;
  let enchant: string | null = null;
  let enchantValue: number | null = null;
  if (b.enchant !== undefined && b.enchant !== null) {
    const values = typeof b.enchant === "string" ? ENCHANT_VALUES[b.enchant] : undefined;
    if (!values || !values.includes(b.enchantValue as number)) return "속성부여가 맞지 않아요";
    enchant = b.enchant as string;
    enchantValue = b.enchantValue as number;
  }
  if ((enhance as number) > 0 && !ENHANCE_CATEGORIES.includes(category)) return "강화는 갑옷, 주장비, 투구, 보조장비, 장갑, 신발만 돼요";
  if (enchant && !ENCHANT_CATEGORIES.includes(category)) return "속성부여는 벨트, 망토, 목걸이, 반지만 돼요";
  const qty = b.qty ?? 1;
  if (!Number.isInteger(qty) || (qty as number) < 1 || (qty as number) > MAX_QTY) return `수량은 1~${MAX_QTY} 로 적어 주세요`;
  if (!validPrice(b.price)) return "가격을 골드로 적어 주세요";
  const note = readNote(b.note);
  if (note === undefined) return `한마디는 ${MAX_NOTE}자까지예요`;
  const options = readOptions(b.options);
  if (typeof options === "string") return options;
  const mode = b.mode ?? "sale";
  if (mode !== "sale" && mode !== "auction") return "판매 방식이 맞지 않아요";
  let hours: number | null = null;
  if (mode === "auction") {
    if (!AUCTION_HOURS.includes(b.hours as number)) return "경매 시간을 골라 주세요";
    hours = b.hours as number;
  }
  return { item, category, enhance: enhance as number, enchant, enchantValue, qty: qty as number, price: b.price, note, options, mode, hours };
}

export interface ListingRow {
  id: number;
  seller: string;
  item: string;
  category: string;
  enhance: number;
  enchant: string | null;
  enchant_value: number | null;
  qty: number;
  price: number;
  note: string | null;
  /** ListingOption[] 의 JSON */
  options: string | null;
  mode: "sale" | "auction";
  /** 경매가 끝나는 때 */
  ends_at: number | null;
  status: "selling" | "sold";
  created_at: number;
  updated_at: number;
}

function parseOptions(json: string | null): ListingOption[] | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ListingOption[];
  } catch {
    return null;
  }
}

/** 화면에 주는 모양 */
export function listingOut(r: ListingRow) {
  return {
    id: r.id, seller: r.seller, item: r.item, category: r.category, enhance: r.enhance, enchant: r.enchant,
    enchantValue: r.enchant_value, qty: r.qty, price: r.price, note: r.note, options: parseOptions(r.options), status: r.status,
    mode: r.mode ?? "sale", endsAt: r.ends_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
