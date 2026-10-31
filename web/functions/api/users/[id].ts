// DELETE /api/users/:id         -> 계정 지우기 (자기보다 낮은 역할만)
// PATCH  /api/users/:id { role } -> 역할 바꾸기 (길드마스터, 앱개발자: 오피서 임명/해제 등)
import { FORBIDDEN, NEED_LOGIN, RANK, canManage, currentUser, isRole, json, paramId, readJson } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import type { Env, Role } from "../../../server/auth";

async function target(env: Env, params: Record<string, string | string[]>) {
  const id = paramId(params);
  return env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(id).first<{ id: string; role: Role }>();
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const user = await target(env, params);
  if (!user) return json({ error: "없는 아이디예요" }, 404);
  if (user.id === me.id || !canManage(me.role, user.role)) return FORBIDDEN();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM profiles WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM level_log WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM avatars WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM activity WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM alerts WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM alert_prefs WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM favorites WHERE user_id = ?").bind(user.id),
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
  if (RANK[me.role] < 2) return FORBIDDEN(); // 오피서는 역할을 바꾸지 못한다
  const user = await target(env, params);
  if (!user) return json({ error: "없는 아이디예요" }, 404);
  const body = await readJson<{ role: string }>(request);
  const role = body.role;
  if (!isRole(role) || user.id === me.id || !canManage(me.role, user.role) || !canManage(me.role, role)) {
    return FORBIDDEN();
  }
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, user.id).run();
  const name = { master: "길드마스터", officer: "오피서", member: "길드원", developer: "앱개발자" }[role];
  await notify(env, [user.id], "account", `역할이 ${name}(으)로 바뀌었어요`, "#/me", me.id);
  return json({ id: user.id, role });
};
