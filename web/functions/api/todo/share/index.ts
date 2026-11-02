// POST /api/todo/share { key, text, note?, at?, members: [아이디] } -> { id } : 할 일을 함께 하는 사람과 공유 (제작자 요청 2026-11-02:
// 길드던전 고정 멤버처럼 같이 하는 사람에게 보이고, 언제 하자고 적는다). 함께 하는 사람에게 알림. 사람은 20명까지, 한 사람이 만든 것 30개까지
import { NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";
import { MAX_SHARES, MAX_SHARE_MEMBERS, TODO_KEY, cleanText, isCustomKey, shareablePeople } from "../../../../server/todo";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ key: unknown; text: unknown; note: unknown; at: unknown; members: unknown }>(request);
  const key = typeof b.key === "string" ? b.key : "";
  const text = cleanText(b.text, 30);
  if (!TODO_KEY.test(key) || !text) return json({ error: "할 일이 맞지 않아요" }, 400);
  // 내 할 일은 내 것만
  if (isCustomKey(key)) {
    const own = await env.DB.prepare("SELECT 1 FROM todo_custom WHERE id = ? AND user_id = ?").bind(Number(key.split(":")[2]), me.id).first();
    if (!own) return json({ error: "내 할 일만 함께 할 수 있어요" }, 400);
  }
  const allowed = new Set((await shareablePeople(env, me.id)).map((p) => p.id));
  const members = [...new Set(Array.isArray(b.members) ? b.members.filter((m): m is string => typeof m === "string") : [])].filter((m) => allowed.has(m));
  if (!members.length) return json({ error: "함께 할 사람을 골라 주세요" }, 400);
  if (members.length > MAX_SHARE_MEMBERS) return json({ error: `함께 할 사람은 ${MAX_SHARE_MEMBERS}명까지예요` }, 400);
  const [already, count] = await env.DB.batch([
    env.DB.prepare("SELECT s.id FROM todo_shares s JOIN todo_share_members m ON m.share_id = s.id WHERE m.user_id = ? AND s.item = ?").bind(me.id, key),
    env.DB.prepare("SELECT COUNT(*) AS n FROM todo_shares WHERE owner = ?").bind(me.id),
  ]);
  if (already.results.length) return json({ error: "이미 함께 하는 할 일이에요" }, 409);
  if (((count.results[0] as { n: number } | undefined)?.n ?? 0) >= MAX_SHARES) return json({ error: `함께 하는 할 일은 ${MAX_SHARES}개까지예요` }, 400);
  const at = cleanText(b.at, 20);
  const now = Date.now();
  const row = await env.DB.prepare("INSERT INTO todo_shares (owner, item, text, note, at_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(me.id, key, text, cleanText(b.note, 20), at, now, now)
    .first<{ id: number }>();
  await env.DB.batch(
    [me.id, ...members].map((m, i) => env.DB.prepare("INSERT INTO todo_share_members (share_id, user_id, added_at) VALUES (?, ?, ?)").bind(row!.id, m, now + i)),
  );
  await notify(env, members, "todo", `${me.id}님이 함께 하재요: ${text}${at ? ` · ${at}` : ""}`, "#/todo", me.id);
  return json({ id: row!.id });
};
