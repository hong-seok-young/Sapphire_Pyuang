// 건의 결재선 (제작자 2026-11-10 '건의함이 게시판이 아니잖아, 건의 접수가 되면 결재선을 만들어서 제대로 처리, 개발 요청처럼'):
// 오피서 합의(1명 이상) -> 길마 결재 -> 건의 접수 완료(accepted) -> 건의 반영 완료(done, 운영진 누구나).
// - 길마 직권: 오피서 합의 없이 결재(skip), 오피서(나 길마)가 반려한 건의를 강제 결재(force). 반려는 오피서·길마가 의견을 꼭 적는다.
// - 받아들여지거나(접수 완료) 반려되거나 반영되면 올린 사람에게 알림. 상태는 board_posts.sg_status (비어 있으면 합의 대기), 이력은 suggest_steps (지우지 않는다)
// 화면 src/pages/SuggestFlow.tsx, API functions/api/board/[id]/suggest.ts
import type { Env, User } from "./auth";
import { RANK } from "./auth";
import { notify } from "./alerts";

export type SgStatus = "agree" | "accepted" | "done" | "rejected";
export type SgKind = "agree" | "approve" | "skip" | "force" | "reject" | "done" | "resubmit";
export const SG_NOTE_MAX = 300;

export interface SgStep {
  user_id: string;
  kind: SgKind;
  note: string | null;
  created_at: number;
}

/** 결재 자리: 합의는 오피서, 결재·직권은 길드마스터, 반영 완료는 운영진 누구나 (오피서 이상, 앱개발자 포함) */
export const sgRole = (me: User) => ({ agree: me.role === "officer", approve: me.role === "master", done: RANK[me.role] >= 1 });

export const sgStatusOf = (s: string | null | undefined): SgStatus => (s === "accepted" || s === "done" || s === "rejected" ? s : "agree");

/** 이번 차례의 이력 (반려 뒤 고쳐서 다시 올리면 그 뒤부터 새 차례) */
export const currentRound = (steps: SgStep[]) => steps.slice(steps.map((s) => s.kind).lastIndexOf("resubmit") + 1);

export async function sgSteps(env: Env, postId: number): Promise<SgStep[]> {
  const { results } = await env.DB.prepare("SELECT user_id, kind, note, created_at FROM suggest_steps WHERE post_id = ? ORDER BY id").bind(postId).all<SgStep>();
  return results;
}

/** 역할마다 사람(본캐) 한 번씩 */
export async function peopleWithRoles(env: Env, roles: string[]): Promise<string[]> {
  const { results } = await env.DB.prepare(`SELECT DISTINCT COALESCE(main_id, id) AS id FROM users WHERE role IN (${roles.map(() => "?").join(", ")})`)
    .bind(...roles)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/** 알림 (게시판 알림 칸). 보낸 사람은 빼고 */
export async function sgTell(env: Env, me: User, to: string[], text: string, link: string): Promise<void> {
  const mine = new Set(me.chars ?? [me.id]);
  const ids = [...new Set(to)].filter((t) => !mine.has(t));
  if (ids.length) await notify(env, ids, "board", text, link, me.id);
}
