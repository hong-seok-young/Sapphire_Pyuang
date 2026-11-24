// PUT /api/diary/:id -> 고침  ·  DELETE /api/diary/:id -> 지움 (보는 사람 둘 다 서로의 줄도. 다른 사람에게는 404)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canUseDiary, readEntry } from "../../../server/diary";

const NOPE = () => new Response("Not found", { status: 404 });

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  const e = readEntry(await readJson<Record<string, unknown>>(request));
  if (typeof e === "string") return json({ error: e }, 400);
  const r = await env.DB.prepare(
    "UPDATE diary_entries SET day = ?, time = ?, place = ?, lv_from = ?, exp_from = ?, lv_to = ?, exp_to = ?, gold = ?, items = ?, note = ?, updated_at = ? WHERE id = ?",
  )
    .bind(e.day, e.time, e.place, e.lv_from, e.exp_from, e.lv_to, e.exp_to, e.gold, e.items, e.note, Date.now(), Number(params.id))
    .run();
  return r.meta.changes ? json({ ok: true }) : json({ error: "없는 일지예요" }, 404);
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  await env.DB.prepare("DELETE FROM diary_entries WHERE id = ?").bind(Number(params.id)).run();
  return json({ ok: true });
};
