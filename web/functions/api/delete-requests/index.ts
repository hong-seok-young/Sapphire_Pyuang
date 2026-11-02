// 계정 삭제 요청 (제작자 요청 2026-11-02: '내 정보' 로그아웃 아래 회색 글씨 '계정 삭제', 오피서가 승낙하면 지운다)
// GET    /api/delete-requests        -> 승낙을 기다리는 요청 (오피서 이상, 길드원 관리 맨 위). ?mine=1 이면 지금 캐릭터의 요청 때 { at }
// POST   /api/delete-requests        -> 지금 캐릭터의 계정 삭제 요청 (길드마스터·오피서·앱개발자에게 알림)
// DELETE /api/delete-requests        -> 내 요청 취소
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { notify } from "../../../server/alerts";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (new URL(request.url).searchParams.get("mine")) {
    const row = await env.DB.prepare("SELECT created_at FROM delete_requests WHERE user_id = ?").bind(me.id).first<{ created_at: number }>();
    return json({ at: row?.created_at ?? null });
  }
  if (RANK[me.role] < 1) return FORBIDDEN();
  const { results } = await env.DB.prepare(
    "SELECT d.user_id AS id, d.created_at AS createdAt, u.role AS role, u.main_id AS mainId, p.guild AS guild, p.job AS job, p.level AS level " +
      "FROM delete_requests d JOIN users u ON u.id = d.user_id LEFT JOIN profiles p ON p.user_id = d.user_id ORDER BY d.created_at",
  ).all();
  return json(results);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  // 앱개발자 계정은 지울 사람이 없어서 받지 않는다
  if (me.role === "developer") return json({ error: "앱개발자 계정은 지울 수 없어요" }, 400);
  const res = await env.DB.prepare("INSERT OR IGNORE INTO delete_requests (user_id, created_at) VALUES (?, ?)").bind(me.id, Date.now()).run();
  if (res.meta.changes) {
    const { results } = await env.DB.prepare("SELECT DISTINCT COALESCE(main_id, id) AS id FROM users WHERE role IN ('developer', 'master', 'officer')").all<{ id: string }>();
    await notify(env, results.map((r) => r.id), "account", `${me.id} 님이 계정 삭제를 요청했어요`, "#/admin", me.id);
  }
  return json({ ok: true }, 201);
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  await env.DB.prepare("DELETE FROM delete_requests WHERE user_id = ?").bind(me.id).run();
  return json({ ok: true });
};
