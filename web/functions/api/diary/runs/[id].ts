// PUT /api/diary/runs/:id -> 고침  ·  DELETE -> 지움 (스샷도). 정산한 줄은 못 고친다 (정산 취소 뒤에)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { NOPE, canUseDiary, readRun } from "../../../../server/diary";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  const r = readRun(await readJson<Record<string, unknown>>(request));
  if (typeof r === "string") return json({ error: r }, 400);
  const res = await env.DB.prepare(
    "UPDATE diary_runs SET day = ?, lv_from = ?, exp_from = ?, t_from = ?, lv_to = ?, exp_to = ?, t_to = ?, updated_at = ? WHERE id = ? AND settle_id IS NULL",
  )
    .bind(r.day, r.lv_from, r.exp_from, r.t_from, r.lv_to, r.exp_to, r.t_to, Date.now(), Number(params.id))
    .run();
  return res.meta.changes ? json({ ok: true }) : json({ error: "정산한 기록은 고칠 수 없어요" }, 409);
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  const id = Number(params.id);
  const res = await env.DB.prepare("DELETE FROM diary_runs WHERE id = ? AND settle_id IS NULL").bind(id).run();
  if (!res.meta.changes) return json({ error: "정산한 기록은 지울 수 없어요" }, 409);
  await env.DB.prepare("DELETE FROM diary_shots WHERE run_id = ?").bind(id).run();
  return json({ ok: true });
};
