// POST /api/todo/custom { cycle: "d"|"w"|"o", text, note? } -> { id, key } : 내 할 일 더하기 (제작자 요청 2026-11-02, 캐릭터마다 30개까지)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_CUSTOM, cleanText, customKey } from "../../../../server/todo";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ cycle: unknown; text: unknown; note: unknown }>(request);
  const cycle = b.cycle === "d" || b.cycle === "w" || b.cycle === "o" ? b.cycle : null;
  const text = cleanText(b.text, 30);
  if (!cycle || !text) return json({ error: "할 일을 적어 주세요" }, 400);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM todo_custom WHERE user_id = ?").bind(me.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_CUSTOM) return json({ error: `내 할 일은 ${MAX_CUSTOM}개까지예요` }, 400);
  const row = await env.DB.prepare("INSERT INTO todo_custom (user_id, cycle, text, note, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(me.id, cycle, text, cleanText(b.note, 20), Date.now())
    .first<{ id: number }>();
  return json({ id: row!.id, key: customKey(cycle, row!.id) });
};
