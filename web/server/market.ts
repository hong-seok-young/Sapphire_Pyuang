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
export const MAX_ENHANCE = 20;
export const MAX_QTY = 9999;
export const MAX_PRICE = 99_999_999_999;
export const MAX_NOTE = 60;
/** 한 사람이 한꺼번에 팔 수 있는 수 (게임 거래소처럼 20) */
export const MAX_SELLING = 20;
/** 거래 완료한 글은 이만큼 지나면 지운다 */
export const KEEP_SOLD_MS = 30 * 86_400_000;

export interface ListingInput {
  item: string;
  category: string;
  enhance: number;
  enchant: string | null;
  enchantValue: number | null;
  qty: number;
  price: number;
  note: string | null;
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
  const qty = b.qty ?? 1;
  if (!Number.isInteger(qty) || (qty as number) < 1 || (qty as number) > MAX_QTY) return `수량은 1~${MAX_QTY} 로 적어 주세요`;
  if (!validPrice(b.price)) return "가격을 골드로 적어 주세요";
  const note = readNote(b.note);
  if (note === undefined) return `한마디는 ${MAX_NOTE}자까지예요`;
  return { item, category, enhance: enhance as number, enchant, enchantValue, qty: qty as number, price: b.price, note };
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
  status: "selling" | "sold";
  created_at: number;
  updated_at: number;
}

/** 화면에 주는 모양 */
export function listingOut(r: ListingRow) {
  return {
    id: r.id, seller: r.seller, item: r.item, category: r.category, enhance: r.enhance, enchant: r.enchant,
    enchantValue: r.enchant_value, qty: r.qty, price: r.price, note: r.note, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
