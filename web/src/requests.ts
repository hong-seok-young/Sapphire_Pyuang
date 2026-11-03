// 길드원 의뢰소 (서버: functions/api/requests, server/requests.ts).
// 의뢰를 자유롭게 올리면 길드원이 한마디('저 20개 있어요', '토요일 밤 돼요')와 함께 수락하고 게임 안에서 거래하거나 함께 한다.
// 여러 명이 수락할 수 있고, 상태는 모집 중·완료 둘뿐: 올린 사람이 완료를 누르면 끝 (제작자 2026-11-03: 최대한 주관식, 수량·기한을 앱이 세지 않는다).
import { api } from "./auth";

export const MAX_TITLE = 60;
export const MAX_DETAIL = 300;
export const MAX_REWARD_TEXT = 40;
export const MAX_NOTE = 60;

export type RequestStatus = "open" | "done";
export const STATUS_NAME: Record<RequestStatus, string> = { open: "모집 중", done: "완료" };

export type OfferStatus = "pledged" | "giveup";

/** 수락 하나: 누가, 한마디 */
export interface RequestOffer {
  id: number;
  user: string;
  note: string | null;
  status: OfferStatus;
  createdAt: number;
}

export interface GuildRequest {
  id: number;
  owner: string;
  title: string;
  detail: string | null;
  rewardGold: number | null;
  rewardText: string | null;
  status: RequestStatus;
  offers: RequestOffer[];
  createdAt: number;
  updatedAt: number;
}

export type RequestAction = "accept" | "giveup" | "done" | "reopen";

/** 살아 있는 수락 (포기하지 않은 것), 수락한 순서 */
export const liveOffers = (r: GuildRequest) => r.offers.filter((o) => o.status === "pledged");

export const fetchRequests = () => api<{ requests: GuildRequest[] }>("/api/requests").then((r) => r.requests);
export const createRequest = (input: { title: string; detail: string | null; rewardGold: number | null; rewardText: string | null }) =>
  api<GuildRequest>("/api/requests", "POST", input);
export const actOnRequest = (id: number, action: RequestAction, note?: string | null) =>
  api<GuildRequest>(`/api/requests/${id}`, "PATCH", note === undefined ? { action } : { action, note });
export const deleteRequest = (id: number) => api<{ ok: boolean }>(`/api/requests/${id}`, "DELETE");

/** 남은 시간: "1일 5시간", "3시간 20분" (중개인 경매도 쓴다) */
export function timeLeft(due: number, now = Date.now()): string {
  const m = Math.max(0, Math.floor((due - now) / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m % 60}분` : `${m % 60}분`;
}
