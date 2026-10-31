// 길드원 의뢰소 (서버: functions/api/requests, server/requests.ts).
// 의뢰를 올리면 모아 둔 길드원이 선착순으로 수락하고, 게임 안에서 거래한다. 수락하고 이틀 안에 안 끝나면 다시 모집 중.
import { api } from "./auth";

export const MAX_TITLE = 60;
export const MAX_DETAIL = 300;
export const MAX_REWARD_TEXT = 40;

export type RequestStatus = "open" | "accepted" | "done";
export const STATUS_NAME: Record<RequestStatus, string> = { open: "모집 중", accepted: "진행 중", done: "완료" };

export interface GuildRequest {
  id: number;
  owner: string;
  title: string;
  detail: string | null;
  rewardGold: number | null;
  rewardText: string | null;
  status: RequestStatus;
  accepter: string | null;
  acceptedAt: number | null;
  /** 진행 중일 때: 이때까지 안 끝나면 다시 모집 중 */
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type RequestAction = "accept" | "giveup" | "release" | "done" | "reopen";

export const fetchRequests = () => api<{ requests: GuildRequest[] }>("/api/requests").then((r) => r.requests);
export const createRequest = (input: { title: string; detail: string | null; rewardGold: number | null; rewardText: string | null }) =>
  api<GuildRequest>("/api/requests", "POST", input);
export const actOnRequest = (id: number, action: RequestAction) => api<GuildRequest>(`/api/requests/${id}`, "PATCH", { action });
export const deleteRequest = (id: number) => api<{ ok: boolean }>(`/api/requests/${id}`, "DELETE");

/** 남은 시간: "1일 5시간", "3시간 20분" */
export function timeLeft(due: number, now = Date.now()): string {
  const m = Math.max(0, Math.floor((due - now) / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m % 60}분` : `${m % 60}분`;
}
