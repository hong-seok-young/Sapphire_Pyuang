// PUT /api/todo/custom/:id { text, note? } -> 내 할 일 고치기 (함께 하는 사람에게 보이는 이름도 같이)
// DELETE /api/todo/custom/:id -> 내 할 일 지우기 (그 할 일로 만든 '함께'도 끈다). 본인 것만
import { NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { cleanText, customKey } from "../../../../server/todo";

async function mine(env: Env, userId: string, params: Record<string, string | string[]>) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return null;
  return env.DB.prepare("SELECT id, cycle FROM todo_custom WHERE id = ? AND user_id = ?").bind(id, userId).first<{ id: number; cycle: string }>();
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await mine(env, me.id, params);
  if (!row) return json({ error: "없는 할 일이에요" }, 404);
  const b = await readJson<{ text: unknown; note: unknown }>(request);
  const text = cleanText(b.text, 30);
  if (!text) return json({ error: "할 일을 적어 주세요" }, 400);
  const note = cleanText(b.note, 20);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE todo_custom SET text = ?, note = ? WHERE id = ?").bind(text, note, row.id),
    env.DB.prepare("UPDATE todo_shares SET text = ?, note = ?, updated_at = ? WHERE owner = ? AND item = ?").bind(text, note, now, me.id, customKey(row.cycle, row.id)),
  ]);
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await mine(env, me.id, params);
  if (!row) return json({ error: "없는 할 일이에요" }, 404);
  const key = customKey(row.cycle, row.id);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM todo_share_members WHERE share_id IN (SELECT id FROM todo_shares WHERE owner = ? AND item = ?)").bind(me.id, key),
    env.DB.prepare("DELETE FROM todo_shares WHERE owner = ? AND item = ?").bind(me.id, key),
    env.DB.prepare("DELETE FROM todo_edits WHERE user_id = ? AND item = ?").bind(me.id, key),
    env.DB.prepare("DELETE FROM todo_custom WHERE id = ?").bind(row.id),
  ]);
  return json({ ok: true });
};
