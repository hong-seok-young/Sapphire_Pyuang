// DELETE /api/users/:id         -> 계정 지우기 (자기보다 낮은 역할만). 부캐가 있는 본캐를 지우면 가장 먼저 묶은 부캐가 본캐가 되고 비밀번호를 이어받는다
// PATCH  /api/users/:id { role } -> 역할 바꾸기 (오피서 이상: 오피서 임명/해제 등. 오피서도 길드마스터와 같다)
import { FORBIDDEN, NEED_LOGIN, canManage, canManageUser, currentUser, isRole, json, paramId, readJson, samePerson } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import type { Env, Role } from "../../../server/auth";

async function target(env: Env, params: Record<string, string | string[]>) {
  const id = paramId(params);
  return env.DB.prepare("SELECT id, role, main_id FROM users WHERE id = ?").bind(id).first<{ id: string; role: Role; main_id: string | null }>();
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const user = await target(env, params);
  if (!user) return json({ error: "없는 아이디예요" }, 404);
  if (samePerson(me, user) || !(await canManageUser(env, me.role, user.id, user.role))) return FORBIDDEN();
  // 본캐를 지우는데 부캐가 있으면: 가장 먼저 묶은 부캐가 본캐가 되고 비밀번호를 이어받는다 (그 사람은 새 본캐 아이디로 로그인)
  const heir = user.main_id
    ? null
    : await env.DB.prepare("SELECT id FROM users WHERE main_id = ? ORDER BY created_at LIMIT 1").bind(user.id).first<{ id: string }>();
  const promote = heir
    ? [
        env.DB.prepare(
          "UPDATE users SET main_id = NULL, pw_hash = (SELECT pw_hash FROM users WHERE id = ?1), pw_salt = (SELECT pw_salt FROM users WHERE id = ?1), " +
            "pw_iter = (SELECT pw_iter FROM users WHERE id = ?1), must_change = (SELECT must_change FROM users WHERE id = ?1) WHERE id = ?2",
        ).bind(user.id, heir.id),
        env.DB.prepare("UPDATE users SET main_id = ? WHERE main_id = ?").bind(heir.id, user.id),
        env.DB.prepare("UPDATE signup_requests SET owner = ? WHERE owner = ?").bind(heir.id, user.id),
      ]
    : [env.DB.prepare("DELETE FROM signup_requests WHERE owner = ?").bind(user.id)];
  await env.DB.batch([
    ...promote,
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM profiles WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM level_log WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM level_log_archive WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM avatars WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM activity WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM alerts WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM alert_prefs WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM push_subs WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM cutout_log WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM favorites WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM todo_checks WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM chat_msgs WHERE thread_id IN (SELECT id FROM chat_threads WHERE user_id = ?)").bind(user.id),
    env.DB.prepare("DELETE FROM chat_threads WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM chat_gaps WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM plat_wallets WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM layouts WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM chat_usage WHERE user_id = ?").bind(user.id),
    // 게시판: 그 사람의 글(과 거기 딸린 사진, 댓글, 좋아요), 다른 글에 단 댓글과 좋아요
    env.DB.prepare("DELETE FROM board_files WHERE post_id IN (SELECT id FROM board_posts WHERE author = ?)").bind(user.id),
    env.DB.prepare("DELETE FROM board_comments WHERE user_id = ? OR post_id IN (SELECT id FROM board_posts WHERE author = ?)").bind(user.id, user.id),
    env.DB.prepare("DELETE FROM board_likes WHERE user_id = ? OR post_id IN (SELECT id FROM board_posts WHERE author = ?)").bind(user.id, user.id),
    env.DB.prepare("DELETE FROM board_views WHERE user_id = ? OR post_id IN (SELECT id FROM board_posts WHERE author = ?)").bind(user.id, user.id),
    env.DB.prepare("DELETE FROM board_posts WHERE author = ?").bind(user.id),
    env.DB.prepare(
      "DELETE FROM listing_wants WHERE user_id = ? OR listing_id IN (SELECT id FROM listings WHERE seller = ?)",
    ).bind(user.id, user.id),
    env.DB.prepare(
      "DELETE FROM listing_bids WHERE user_id = ? OR listing_id IN (SELECT id FROM listings WHERE seller = ?)",
    ).bind(user.id, user.id),
    env.DB.prepare(
      "DELETE FROM listing_talk WHERE user_id = ? OR listing_id IN (SELECT id FROM listings WHERE seller = ?)",
    ).bind(user.id, user.id),
    env.DB.prepare("DELETE FROM listings WHERE seller = ?").bind(user.id),
    env.DB.prepare(
      "DELETE FROM gold_wants WHERE user_id = ? OR offer_id IN (SELECT id FROM gold_offers WHERE owner = ?)",
    ).bind(user.id, user.id),
    env.DB.prepare("DELETE FROM gold_offers WHERE owner = ?").bind(user.id),
    env.DB.prepare("DELETE FROM requests WHERE owner = ?").bind(user.id),
    env.DB.prepare(
      "UPDATE requests SET status = 'open', accepter = NULL, accepted_at = NULL WHERE accepter = ? AND status = 'accepted'",
    ).bind(user.id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  return json({ ok: true });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const user = await target(env, params);
  if (!user) return json({ error: "없는 아이디예요" }, 404);
  const body = await readJson<{ role: string }>(request);
  const role = body.role;
  if (!isRole(role) || samePerson(me, user) || !(await canManageUser(env, me.role, user.id, user.role)) || !canManage(me.role, role)) {
    return FORBIDDEN();
  }
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, user.id).run();
  const name = { master: "길드마스터", officer: "오피서", member: "길드원", developer: "앱개발자" }[role];
  await notify(env, [user.id], "account", `역할이 ${name}(으)로 바뀌었어요`, "#/me", me.id);
  return json({ id: user.id, role });
};
