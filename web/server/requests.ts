// 길드원 의뢰소: "검은진액 100개, 보상 5만 골드", "토요일 밤 인던 같이 가요" 같은 의뢰를 자유롭게 올리고, 길드원이 '수락'한 뒤
// 게임 안에서 거래하거나 함께 한다 (길드원 김다혜 님 제안, 제작자 요청). 게임에 아무것도 보내지 않는다. 화면 쪽: web/src/requests.ts
//
// 2026-11-03 고도화 (제작자 요청: '이틀 이런 거 정하지 말고 올리는 사람이 다 직접 정하게', '100개 의뢰했는데 20개 가진 사람 5명이 모이면 되는 거잖아,
// 수락할 때 저 몇 개 있어요 이런 걸 쓰고 수락', '다 모이면이 아니라 한 명이 수락해서 20개 먼저 넘겨줄 수 있고, 진행 중이 필요 없을 듯',
// '몇 개 받는 의뢰만 있는 게 아니라 인던 같이 가자거나 정말 다양해, 최대한 주관식으로', '자동 완료나 수량 얼마나 찼는지 신경 쓰지 말고
// 그냥 의뢰자가 완료 누르면 완료'):
// - 상태는 모집 중(open)과 완료(done) 둘뿐. 예전 '진행 중'(accepted)과 고정 '이틀'(수락 뒤 이틀이면 다시 모집)은 뺐다. 앱이 저절로 풀거나 닫지 않는다.
// - 수락은 여러 사람이 할 수 있고 한 사람은 한 의뢰에 한 번 (request_offers 한 줄: 한마디 note 에 '저 20개 있어요' 같은 것을 자유롭게).
//   수락한 사람은 '포기'할 수 있다. 수량·기한·조건은 모두 글(의뢰의 자세히, 수락의 한마디)로 주고받고 앱은 세지 않는다.
// - 의뢰한 사람이 게임 안에서 거래를 마치고 '완료'를 누르면 끝. 끝난 의뢰는 '다시 모집'.
// - 예전 한 사람 수락(requests.accepter)은 배포 때 request_offers 로 옮기고 '진행 중'은 모집 중으로 (scripts/ci-d1.mjs). 그 칸은 더 쓰지 않는다.
import { MAX_PRICE } from "./market";

export const MAX_TITLE = 60;
export const MAX_DETAIL = 300;
export const MAX_REWARD_TEXT = 40;
export const MAX_NOTE = 60;
/** 한 사람이 한꺼번에 올려 둘 수 있는 의뢰 */
export const MAX_OPEN_REQUESTS = 10;
/** 한 의뢰에 수락하는 사람 */
export const MAX_OFFERS = 30;
/** 끝난 의뢰는 이만큼만 목록에 보인다. 기록은 지우지 않는다 (제작자 요청 2026-11-01: 기록은 평생) */
export const SHOW_DONE_MS = 30 * 86_400_000;

export interface RequestInput {
  title: string;
  detail: string | null;
  rewardGold: number | null;
  rewardText: string | null;
}

/** 글자 칸: 비우면 null, 너무 길면 undefined */
export function text(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return null;
  return t.length <= max ? t : undefined;
}

/** 화면이 보낸 의뢰를 검사한다. 맞으면 RequestInput, 아니면 이유 */
export function readRequest(b: Record<string, unknown>): RequestInput | string {
  const title = text(b.title, MAX_TITLE);
  if (!title) return `의뢰 내용을 ${MAX_TITLE}자까지 적어 주세요`;
  const detail = text(b.detail, MAX_DETAIL);
  if (detail === undefined) return `자세히는 ${MAX_DETAIL}자까지예요`;
  const rewardText = text(b.rewardText, MAX_REWARD_TEXT);
  if (rewardText === undefined) return `보상은 ${MAX_REWARD_TEXT}자까지예요`;
  let rewardGold: number | null = null;
  if (b.rewardGold !== undefined && b.rewardGold !== null) {
    if (!Number.isInteger(b.rewardGold) || (b.rewardGold as number) < 1 || (b.rewardGold as number) > MAX_PRICE) return "보상 골드가 맞지 않아요";
    rewardGold = b.rewardGold as number;
  }
  if (rewardGold === null && rewardText === null) return "보상을 골드나 글로 적어 주세요";
  if (rewardGold !== null && rewardText !== null) return "보상은 골드나 글 중 하나만 적어 주세요";
  return { title, detail, rewardGold, rewardText };
}

export interface RequestRow {
  id: number;
  owner: string;
  title: string;
  detail: string | null;
  reward_gold: number | null;
  reward_text: string | null;
  /** accepted 는 예전 '진행 중' (배포가 open 으로 바꾼다) */
  status: "open" | "accepted" | "done";
  /** 예전 한 사람 수락 (2026-11-03 부터 안 쓴다, request_offers 로 옮김) */
  accepter: string | null;
  accepted_at: number | null;
  created_at: number;
  updated_at: number;
}

export type OfferStatus = "pledged" | "giveup";

/** 수락 하나: 누가, 한마디 ('저 20개 있어요', '토요일 밤 돼요') */
export interface OfferRow {
  id: number;
  request_id: number;
  user_id: string;
  note: string | null;
  status: OfferStatus;
  created_at: number;
  updated_at: number;
}

/** 화면에 주는 모양: 의뢰와 그 수락들 */
export function requestOut(r: RequestRow, offers: OfferRow[]) {
  return {
    id: r.id, owner: r.owner, title: r.title, detail: r.detail, rewardGold: r.reward_gold, rewardText: r.reward_text,
    status: r.status === "done" ? ("done" as const) : ("open" as const),
    offers: offers.filter((o) => o.request_id === r.id).map((o) => ({ id: o.id, user: o.user_id, note: o.note, status: o.status, createdAt: o.created_at })),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** 의뢰의 수락들 (여러 의뢰를 한 번에, 수락한 순서) */
export async function offersOf(db: D1Database, ids: number[]): Promise<OfferRow[]> {
  if (!ids.length) return [];
  const { results } = await db
    .prepare("SELECT * FROM request_offers WHERE request_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, id")
    .bind(JSON.stringify(ids))
    .all<OfferRow>();
  return results;
}
