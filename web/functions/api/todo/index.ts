// GET /api/todo -> { tasks, done, pending, working, custom, edits, shares, dayEnd, weekEnd } : To do 의 이벤트 할 일(지금 이 캐릭터의 레벨·직업에 맞는 것)과 체크한 것,
// 내 할 일, 숨기거나 고친 것, 함께 하는 할 일 (server/todo.ts todoExtras)
// PUT /api/todo { key, done } -> 체크 / 풀기 (그 주기 안에서만 남는다: d 오늘, w 이번 주(목요일 오전 10시), o 계속)
// 길드 출석, 길드 임무, 인던 같은 늘 하는 일은 화면이 만든다 (src/todo.ts). 제작자 요청 2026-11-01. 서버 server/todo.ts
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { WEEK, weekStart } from "../../../server/week";
import { TODO_KEY, dayEnd, doneKeys, eventTasks, pendingCount, periodOf, todoExtras } from "../../../server/todo";

/** 한 주기에 체크할 수 있는 수 (늘 하는 일과 이벤트 할 일을 다 해도 이보다 적다) */
const MAX_PER_PERIOD = 200;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const now = Date.now();
  const profile = (await env.DB.prepare("SELECT job, level FROM profiles WHERE user_id = ?").bind(me.id).first<{ job: string; level: number }>()) ?? {
    job: null,
    level: null,
  };
  const [tasks, done, count, extras] = await Promise.all([eventTasks(env, profile, now), doneKeys(env, me.id, now), pendingCount(env, now), todoExtras(env, me.id, now)]);
  return json({ tasks, done, ...count, ...extras, dayEnd: dayEnd(now), weekEnd: weekStart(now) + WEEK, now }, 200, { "cache-control": "no-store" });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ key: unknown; done: unknown }>(request);
  const key = typeof b.key === "string" ? b.key : "";
  const period = TODO_KEY.test(key) ? periodOf(key) : null;
  if (!period || typeof b.done !== "boolean") return json({ error: "할 일이 맞지 않아요" }, 400);
  if (!b.done) {
    await env.DB.prepare("DELETE FROM todo_checks WHERE user_id = ? AND item = ? AND period = ?").bind(me.id, key, period).run();
    return json({ ok: true });
  }
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM todo_checks WHERE user_id = ? AND period = ?").bind(me.id, period).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_PER_PERIOD) return json({ error: "체크가 너무 많아요" }, 400);
  await env.DB.prepare("INSERT INTO todo_checks (user_id, item, period, done_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, item, period) DO NOTHING")
    .bind(me.id, key, period, Date.now())
    .run();
  return json({ ok: true });
};
