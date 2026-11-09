// POST /api/fit/workouts { data } -> 운동 끝: 끝낸 세트만 기록으로 남기고 하는 중인 운동(draft)을 지운다 (server/fit.ts readWorkout)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { canUseFit, kstDay, readWorkout } from "../../../../server/fit";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseFit(me)) return FORBIDDEN();
  const now = Date.now();
  const r = readWorkout((await readJson<{ data: unknown }>(request)).data, now);
  if (typeof r === "string") return json({ error: r }, 400);
  const [ins] = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO fit_workouts (user_id, day, started_at, ended_at, title, volume, sets, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "RETURNING id, day, started_at, ended_at, title, volume, sets, data",
    ).bind(me.id, kstDay(r.w.started), r.w.started, r.w.ended, r.w.title, r.volume, r.sets, JSON.stringify(r.w), now),
    env.DB.prepare("DELETE FROM fit_drafts WHERE user_id = ?").bind(me.id),
  ]);
  return json(ins.results[0], 201);
};
