// POST /api/diary/runs { day, lv_from, exp_from, t_from, lv_to, exp_to, t_to } -> { id } : 기록 한 줄 (스샷은 runs/:id/shot 으로 따로)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { NOPE, canUseDiary, readRun } from "../../../../server/diary";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  const r = readRun(await readJson<Record<string, unknown>>(request));
  if (typeof r === "string") return json({ error: r }, 400);
  const now = Date.now();
  const row = await env.DB.prepare(
    "INSERT INTO diary_runs (author, day, lv_from, exp_from, t_from, lv_to, exp_to, t_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(me.id, r.day, r.lv_from, r.exp_from, r.t_from, r.lv_to, r.exp_to, r.t_to, now, now)
    .first<{ id: number }>();
  return json({ id: row?.id }, 201);
};
