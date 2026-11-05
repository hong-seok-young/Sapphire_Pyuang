// 개발 요청 (개발중, 제작자 요청 2026-11-05): 화면 src/pages/DevRequests.tsx, 서버 server/devreq.ts, functions/api/devreq
import { api } from "./auth";

export type Scope = "me" | "some" | "all";
export type Status = "review" | "agree" | "dev" | "done" | "rejected";
export type StepKind = "submit" | "resubmit" | "feasible" | "agree" | "approve" | "skip" | "force" | "reject" | "done";

export interface DevStep {
  req_id: number;
  round: number;
  user_id: string;
  kind: StepKind;
  note: string | null;
  created_at: number;
}
export interface DevReq {
  id: number;
  user_id: string;
  body: string;
  scope: Scope;
  people: string[];
  status: Status;
  round: number;
  created_at: number;
  updated_at: number;
  steps: DevStep[];
  talk: number;
}
export interface DevRole {
  dev: boolean;
  agree: boolean;
  approve: boolean;
}
export interface DevTalk {
  id: number;
  user_id: string;
  text: string;
  created_at: number;
}

export const loadDevReqs = () => api<{ list: DevReq[]; role: DevRole }>("/api/devreq");
export const addDevReq = (b: { body: string; scope: Scope; people: string[] }) => api<{ id: number }>("/api/devreq", "POST", b);
export const editDevReq = (id: number, b: { body: string; scope: Scope; people: string[] }) => api<{ ok: true; resubmitted?: boolean }>(`/api/devreq/${id}`, "PUT", b);
export const delDevReq = (id: number) => api<{ ok: true }>(`/api/devreq/${id}`, "DELETE");
export type DevAct = "feasible" | "agree" | "approve" | "skip" | "force" | "reject" | "done";
export const actDevReq = (id: number, act: DevAct, note: string) =>
  api<{ ok: true; status: Status }>(`/api/devreq/${id}/act`, "POST", { act, note });
export const loadDevTalk = (id: number) => api<{ talk: DevTalk[] }>(`/api/devreq/${id}/talk`);
export const addDevTalk = (id: number, text: string) => api<{ id: number }>(`/api/devreq/${id}/talk`, "POST", { text });
export const loadPeople = () => api<{ people: { id: string; job: string | null; level: number | null; guild: string | null }[] }>("/api/todo/people");

export const STATUS_NAME: Record<Status, string> = {
  review: "개발자 검토",
  agree: "합의·결재",
  dev: "개발 중",
  done: "완료",
  rejected: "반려",
};
export const SCOPE_NAME: Record<Scope, string> = { me: "나", some: "특정 인원", all: "길드 전체" };

/** 이번 차례(round)의 결재 이력 */
export const roundSteps = (r: DevReq) => r.steps.filter((s) => s.round === r.round);

/** 지금 이 사람이 결재할 차례인지 */
export function myTurn(r: DevReq, role: DevRole, me: string, mine: boolean): boolean {
  if (r.status === "review") return role.dev;
  if (r.status === "agree") {
    const st = roundSteps(r);
    const agreed = st.filter((s) => s.kind === "agree");
    if (role.agree && !mine && !agreed.some((s) => s.user_id === me)) return true;
    return role.approve && agreed.length > 0;
  }
  if (r.status === "dev") return role.dev;
  if (r.status === "rejected") return mine;
  return false;
}
