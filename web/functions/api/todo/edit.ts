// PUT /api/todo/edit { key, hidden?, text?, note?, reset? } -> 늘 하는 일·이벤트 할 일을 나만 숨기거나 이름·어디서를 고친다 (제작자 요청 2026-11-02).
// reset: 원래대로 (고친 것을 지운다). 내 할 일(키 '<주기>:c:<번호>')은 /api/todo/custom 으로 고친다
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { TODO_KEY, cleanText, isCustomKey } from "../../../server/todo";

const MAX_EDITS = 200;

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ key: unknown; hidden: unknown; text: unknown; note: unknown; reset: unknown }>(request);
  const key = typeof b.key === "string" ? b.key : "";
  if (!TODO_KEY.test(key) || isCustomKey(key)) return json({ error: "할 일이 맞지 않아요" }, 400);
  if (b.reset === true) {
    await env.DB.prepare("DELETE FROM todo_edits WHERE user_id = ? AND item = ?").bind(me.id, key).run();
    return json({ ok: true });
  }
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM todo_edits WHERE user_id = ? AND item != ?").bind(me.id, key).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_EDITS) return json({ error: "고친 할 일이 너무 많아요" }, 400);
  // 보낸 칸만 바꾼다 (숨기기만 누르면 이름은 그대로)
  const old = await env.DB.prepare("SELECT hidden, text, note FROM todo_edits WHERE user_id = ? AND item = ?")
    .bind(me.id, key)
    .first<{ hidden: number; text: string | null; note: string | null }>();
  const hidden = typeof b.hidden === "boolean" ? (b.hidden ? 1 : 0) : (old?.hidden ?? 0);
  const text = "text" in b ? cleanText(b.text, 30) : (old?.text ?? null);
  const note = "note" in b ? cleanText(b.note, 20) : (old?.note ?? null);
  await env.DB.prepare(
    "INSERT INTO todo_edits (user_id, item, hidden, text, note, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT (user_id, item) DO UPDATE SET hidden = excluded.hidden, text = excluded.text, note = excluded.note, updated_at = excluded.updated_at",
  )
    .bind(me.id, key, hidden, text, note, Date.now())
    .run();
  return json({ ok: true });
};
