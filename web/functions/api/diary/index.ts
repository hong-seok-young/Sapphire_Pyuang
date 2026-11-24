// GET /api/diary -> 일지 (최근 날짜부터 500개)  ·  POST /api/diary { day, time, place, lv_from, exp_from, lv_to, exp_to, gold, items, note } -> 한 줄 더함
// 보는 사람만 (server/diary.ts). 다른 사람에게는 없는 주소처럼 404. 사용 기록에 남기지 않는다 (functions/api/_middleware.ts)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canUseDiary, readEntry } from "../../../server/diary";

const NOPE = () => new Response("Not found", { status: 404 });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  const { results } = await env.DB.prepare("SELECT * FROM diary_entries ORDER BY day DESC, id DESC LIMIT 500").all();
  return json({ entries: results }, 200, { "cache-control": "no-store" });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  const e = readEntry(await readJson<Record<string, unknown>>(request));
  if (typeof e === "string") return json({ error: e }, 400);
  const now = Date.now();
  const r = await env.DB.prepare(
    "INSERT INTO diary_entries (author, day, time, place, lv_from, exp_from, lv_to, exp_to, gold, items, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(me.id, e.day, e.time, e.place, e.lv_from, e.exp_from, e.lv_to, e.exp_to, e.gold, e.items, e.note, now, now)
    .run();
  return json({ ok: true, id: r.meta.last_row_id });
};
