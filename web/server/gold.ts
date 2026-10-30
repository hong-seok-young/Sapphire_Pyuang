// 골드 거래 (사파이어 중개인의 '골드' 칸): 게임 골드를 원화로 사고팔려는 글과 '거래할래요'.
// 현금거래는 게임 운영정책 위반으로 계정이 정지될 수 있다고 제작자에게 알렸고, 제작자가 그래도 만들라고 했다 (2026-10-31).
// 앱은 돈을 받거나 보내지 않는다. 글과 연락만 모은다. 화면 쪽: web/src/gold.ts
import { readNote } from "./market";

/** 금액은 만 골드 단위 (750 = 750만 골드). 1만 ~ 100억 골드 */
export const MAX_GOLD = 1_000_000;
/** 시세: 1만 원에 몇 만 골드인지 (75 = 75:1) */
export const MAX_RATE = 9999;
/** 한 사람이 한꺼번에 올려 둘 수 있는 골드 글 */
export const MAX_OPEN_GOLD = 5;
/** 거래 끝난 글은 이만큼 지나면 지운다 */
export const KEEP_DONE_MS = 30 * 86_400_000;

export interface GoldInput {
  side: "sell" | "buy";
  gold: number;
  rate: number;
  note: string | null;
}

export function validGold(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_GOLD;
}

export function validRate(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_RATE;
}

/** 화면이 보낸 골드 글을 검사한다. 맞으면 GoldInput, 아니면 이유 */
export function readGold(b: Record<string, unknown>): GoldInput | string {
  if (b.side !== "sell" && b.side !== "buy") return "팝니다, 삽니다 중에 골라 주세요";
  if (!validGold(b.gold)) return "골드는 만 골드 단위로 1 ~ 1,000,000 사이로 적어 주세요";
  if (!validRate(b.rate)) return "시세는 1만 원에 몇 만 골드인지 적어 주세요 (예: 75)";
  const note = readNote(b.note);
  if (note === undefined) return "한마디는 60자까지예요";
  return { side: b.side, gold: b.gold, rate: b.rate, note };
}

export interface GoldRow {
  id: number;
  owner: string;
  side: "sell" | "buy";
  gold: number;
  rate: number;
  note: string | null;
  status: "open" | "done";
  created_at: number;
  updated_at: number;
}

/** 화면에 주는 모양 */
export function goldOut(r: GoldRow) {
  return {
    id: r.id, owner: r.owner, side: r.side, gold: r.gold, rate: r.rate, note: r.note, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
