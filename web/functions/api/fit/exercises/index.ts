// POST /api/fit/exercises { name, part, kind } -> 내 종목 더하기 (헬스 루틴, server/fit.ts)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_CUSTOM, canUseFit, readExercise } from "../../../../server/fit";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseFit(me)) return FORBIDDEN();
  const ex = readExercise(await readJson<{ name: unknown; part: unknown; kind: unknown }>(request));
  if (typeof ex === "string") return json({ error: ex }, 400);
  const have = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(name = ?) AS same FROM fit_exercises WHERE user_id = ?")
    .bind(ex.name, me.id)
    .first<{ n: number; same: number | null }>();
  if ((have?.same ?? 0) > 0) return json({ error: "이미 있는 종목이에요" }, 409);
  if ((have?.n ?? 0) >= MAX_CUSTOM) return json({ error: `내 종목은 ${MAX_CUSTOM}개까지예요` }, 409);
  const row = await env.DB.prepare("INSERT INTO fit_exercises (user_id, name, part, kind, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id, name, part, kind")
    .bind(me.id, ex.name, ex.part, ex.kind, Date.now())
    .first();
  return json(row, 201);
};
