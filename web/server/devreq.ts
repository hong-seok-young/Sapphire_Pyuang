// 개발 요청 (제작자 요청 2026-11-05, 같은 날 길드원 전체에게 열었다: 모든 요청과 결재 단계·의견을 모두가 본다): 길드원이 필요한 기능을 앱개발자에게 자유롭게 신청한다 (이 개발자는 무료로 해 준다).
// - 범위: me(나) | some(특정 인원) | all(길드 전체). 내용은 글 하나.
// - 결재선: 신청 -> 앱개발자 '개발 가능'(review -> agree) -> 오피서 합의 1명 이상 -> 길드마스터 최종 결재(agree -> dev) -> 앱개발자 '개발 완료'(dev -> done).
//   합의·결재에는 앱개발자에게 '이렇게 만들어 달라'는 결재 의견을 단다. 어느 단계에서든 반려(의견 필수)하면 rejected,
//   신청한 사람이 반려 의견을 보고 고쳐서 다시 신청하면 review 로 돌아가고 round 가 1 오른다 (앞 차례 이력은 남는다).
// - 앱개발자는 검토·완료만 한다 (합의·결재는 오피서·길드마스터). 자기 요청에는 합의하지 않는다.
// - 열기 전에는 미리 보는 사람만이었다 (server/simcoin.ts canSim). DEVREQ_OPEN 을 끄면 다시 그렇게 된다
import type { Env, User } from "./auth";
import { notify } from "./alerts";
import { canSim } from "./simcoin";

export const DEVREQ_OPEN = true;
export const canUseDevReq = (me: User) => DEVREQ_OPEN || canSim(me);

export type Scope = "me" | "some" | "all";
export type Status = "review" | "agree" | "dev" | "done" | "rejected";
export type StepKind = "submit" | "resubmit" | "feasible" | "agree" | "approve" | "reject" | "done";

export const MAX_BODY = 1000;
export const MAX_NOTE = 300;
export const MAX_PEOPLE = 30;

export interface DevReqRow {
  id: number;
  user_id: string;
  body: string;
  scope: Scope;
  people: string | null;
  status: Status;
  round: number;
  created_at: number;
  updated_at: number;
}

/** 이 사람이 할 수 있는 결재 자리 */
export const roleOf = (me: User) => ({
  dev: me.role === "developer",
  agree: me.role === "officer",
  approve: me.role === "master",
});

export function readScope(b: { scope?: unknown; people?: unknown }): { scope: Scope; people: string[] } | string {
  const scope = b.scope === "some" || b.scope === "all" ? b.scope : b.scope === "me" ? "me" : null;
  if (!scope) return "범위를 골라 주세요";
  if (scope !== "some") return { scope, people: [] };
  const people = Array.isArray(b.people) ? [...new Set(b.people.filter((p): p is string => typeof p === "string" && p.length > 0 && p.length <= 20))] : [];
  if (!people.length) return "누구를 위한 기능인지 골라 주세요";
  if (people.length > MAX_PEOPLE) return `특정 인원은 ${MAX_PEOPLE}명까지예요`;
  return { scope, people };
}

export const readBody = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= MAX_BODY ? t : null;
};

export const readNote = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, MAX_NOTE) : "");

/** 알림 글에 붙이는 요청 앞부분 */
export const shortOf = (body: string) => {
  const t = body.replace(/\s+/g, " ").trim();
  return t.length > 30 ? `${t.slice(0, 30)}…` : t;
};

/** 역할마다 사람(본캐) 한 번씩 */
async function peopleWithRole(env: Env, role: "developer" | "officer" | "master"): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT DISTINCT COALESCE(main_id, id) AS id FROM users WHERE role = ?").bind(role).all<{ id: string }>();
  return results.map((r) => r.id);
}

/** 알림 (알림 설정 '개발 요청'). 보낸 사람(같은 사람의 캐릭터 포함)은 빼고 */
export async function tell(
  env: Env,
  me: User,
  to: ("owner" | "developer" | "officer" | "master" | string)[],
  row: DevReqRow,
  text: string,
): Promise<void> {
  const ids = new Set<string>();
  for (const t of to) {
    if (t === "owner") ids.add(row.user_id);
    else if (t === "developer" || t === "officer" || t === "master") for (const id of await peopleWithRole(env, t)) ids.add(id);
    else ids.add(t);
  }
  const self = new Set([me.id, me.owner ?? me.id, ...(me.chars ?? [])]);
  const list = [...ids].filter((id) => !self.has(id));
  if (list.length) await notify(env, list, "devreq", text, `#/devreq?id=${row.id}`, me.id);
}

/** 이번 차례 합의한 사람 수 */
export async function agreesOf(env: Env, row: DevReqRow): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT user_id FROM dev_request_steps WHERE req_id = ? AND round = ? AND kind = 'agree'")
    .bind(row.id, row.round)
    .all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}

export const ownerSame = (me: User, row: DevReqRow) => {
  const mine = new Set([me.id, me.owner ?? me.id, ...(me.chars ?? [])]);
  return mine.has(row.user_id);
};
