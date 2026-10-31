// 성장 기록 바로잡기 (오피서 이상, 다룰 수 있는 계정만. 제작자 요청: 잘못 쓴 것을 고쳤는데 레벨업·경험치 오름으로 잡힌 기록)
// GET    /api/users/:id/levellog        -> 그 사람의 레벨·경험치 기록 (최근 60개)과 레벨업 표시(prev_level)
// DELETE /api/users/:id/levellog?at=    -> 기록 하나 지우기 (성장 랭킹이 다시 계산된다)
// PATCH  /api/users/:id/levellog { clearBadge: true } -> 레벨업 ▲ 표시 지우기
import { FORBIDDEN, NEED_LOGIN, canManage, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env, Role } from "../../../../server/auth";

async function target(env: Env, request: Request, params: Record<string, string | string[]>) {
  const me = await currentUser(env, request);
  if (!me) return { error: NEED_LOGIN() };
  const user = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(paramId(params)).first<{ id: string; role: Role }>();
  if (!user) return { error: json({ error: "없는 아이디예요" }, 404) };
  if (!canManage(me.role, user.role)) return { error: FORBIDDEN() };
  return { user };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const t = await target(env, request, params);
  if (t.error) return t.error;
  const [log, profile] = await env.DB.batch([
    env.DB.prepare("SELECT at, level, exp FROM level_log WHERE user_id = ? ORDER BY at DESC LIMIT 60").bind(t.user.id),
    env.DB.prepare("SELECT level, exp, prev_level AS prevLevel, level_at AS levelAt FROM profiles WHERE user_id = ?").bind(t.user.id),
  ]);
  return json({ log: log.results, profile: profile.results[0] ?? null });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const t = await target(env, request, params);
  if (t.error) return t.error;
  const at = Number(new URL(request.url).searchParams.get("at"));
  if (!Number.isFinite(at) || at <= 0) return json({ error: "지울 기록을 골라 주세요" }, 400);
  await env.DB.prepare("DELETE FROM level_log WHERE user_id = ? AND at = ?").bind(t.user.id, at).run();
  return json({ ok: true });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const t = await target(env, request, params);
  if (t.error) return t.error;
  const b = await readJson<{ clearBadge: unknown }>(request);
  if (b.clearBadge !== true) return json({ error: "clearBadge 만 돼요" }, 400);
  await env.DB.prepare("UPDATE profiles SET prev_level = NULL WHERE user_id = ?").bind(t.user.id).run();
  return json({ ok: true });
};
