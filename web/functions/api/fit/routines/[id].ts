// PUT /api/fit/routines/:id { name, items } -> 루틴 고치기, DELETE -> 루틴 지우기 (그 루틴으로 한 운동 기록은 남는다). server/fit.ts
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { canUseFit, readRoutine } from "../../../../server/fit";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseFit(me)) return FORBIDDEN();
  const r = readRoutine(await readJson<{ name: unknown; items: unknown }>(request));
  if (typeof r === "string") return json({ error: r }, 400);
  const row = await env.DB.prepare("UPDATE fit_routines SET name = ?, items = ?, updated_at = ? WHERE id = ? AND user_id = ? RETURNING id, name, items, updated_at")
    .bind(r.name, JSON.stringify(r.items), Date.now(), Number(params.id), me.id)
    .first();
  if (!row) return json({ error: "없는 루틴이에요" }, 404);
  return json(row);
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseFit(me)) return FORBIDDEN();
  const r = await env.DB.prepare("DELETE FROM fit_routines WHERE id = ? AND user_id = ?").bind(Number(params.id), me.id).run();
  if (!r.meta.changes) return json({ error: "없는 루틴이에요" }, 404);
  return json({ ok: true });
};
