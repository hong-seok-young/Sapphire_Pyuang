// 길드원 의뢰소: "검은진액 100개, 보상 5만 골드" 같은 의뢰를 올리고, 모아 둔 길드원이 선착순으로 '수락'한 뒤
// 게임 안에서 거래한다 (길드원 김다혜 님 제안, 제작자 요청). 수락하고 이틀 안에 끝나지 않으면 다시 모집 중이 된다.
// 게임에 아무것도 보내지 않는다. 화면 쪽: web/src/requests.ts
import { MAX_PRICE } from "./market";

export const MAX_TITLE = 60;
export const MAX_DETAIL = 300;
export const MAX_REWARD_TEXT = 40;
/** 한 사람이 한꺼번에 올려 둘 수 있는 의뢰 */
export const MAX_OPEN_REQUESTS = 10;
/** 수락하고 이만큼 지나도 끝나지 않으면 다시 모집 중 */
export const ACCEPT_MS = 2 * 86_400_000;
/** 끝난 의뢰는 이만큼 보여 주고 지운다 */
export const KEEP_DONE_MS = 30 * 86_400_000;

export interface RequestInput {
  title: string;
  detail: string | null;
  rewardGold: number | null;
  rewardText: string | null;
}

/** 글자 칸: 비우면 null, 너무 길면 undefined */
function text(v: unknown, max: number): string | null | undefined {
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
  if (detail === undefined) return `자세한 설명은 ${MAX_DETAIL}자까지예요`;
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
  status: "open" | "accepted" | "done";
  accepter: string | null;
  accepted_at: number | null;
  created_at: number;
  updated_at: number;
}

/** 화면에 주는 모양. 수락한 의뢰는 다시 모집 중이 되는 때(dueAt)도 준다 */
export function requestOut(r: RequestRow) {
  return {
    id: r.id, owner: r.owner, title: r.title, detail: r.detail, rewardGold: r.reward_gold, rewardText: r.reward_text,
    status: r.status, accepter: r.accepter, acceptedAt: r.accepted_at,
    dueAt: r.status === "accepted" && r.accepted_at ? r.accepted_at + ACCEPT_MS : null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** 수락하고 이틀이 지난 의뢰는 다시 모집 중으로, 오래된 끝난 의뢰는 지운다 */
export function tidyRequests(db: D1Database, now: number): D1PreparedStatement[] {
  return [
    db.prepare(
      "UPDATE requests SET status = 'open', accepter = NULL, accepted_at = NULL, updated_at = ?1 " +
        "WHERE status = 'accepted' AND accepted_at < ?2",
    ).bind(now, now - ACCEPT_MS),
    db.prepare("DELETE FROM requests WHERE status = 'done' AND updated_at < ?").bind(now - KEEP_DONE_MS),
  ];
}
