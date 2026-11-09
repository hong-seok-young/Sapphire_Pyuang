// POST /api/fit/routines { name, items } -> 새 루틴 (헬스 루틴, server/fit.ts)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_ROUTINES, canUseFit, readRoutine } from "../../../../server/fit";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseFit(me)) return FORBIDDEN();
  const r = readRoutine(await readJson<{ name: unknown; items: unknown }>(request));
  if (typeof r === "string") return json({ error: r }, 400);
  const have = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(sort) AS top FROM fit_routines WHERE user_id = ?").bind(me.id).first<{ n: number; top: number | null }>();
  if ((have?.n ?? 0) >= MAX_ROUTINES) return json({ error: `루틴은 ${MAX_ROUTINES}개까지예요` }, 409);
  const now = Date.now();
  const row = await env.DB.prepare(
    "INSERT INTO fit_routines (user_id, name, items, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, name, items, updated_at",
  )
    .bind(me.id, r.name, JSON.stringify(r.items), (have?.top ?? 0) + 1, now, now)
    .first();
  return json(row, 201);
};
