// PUT /api/todo/share/:id { at?, members? } -> 언제 고치기(함께 하는 사람 누구나), 사람 넣고 빼기(만든 사람만). 새로 넣은 사람과, 언제가 바뀌면 나머지에게 알림
// DELETE /api/todo/share/:id -> 만든 사람은 끄기(모두에게서 사라진다), 나머지는 나가기
import { NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";
import { MAX_SHARE_MEMBERS, cleanText, shareablePeople } from "../../../../server/todo";

interface Share {
  id: number;
  owner: string;
  text: string;
  at_text: string | null;
}

async function load(env: Env, userId: string, params: Record<string, string | string[]>) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return null;
  const [shareR, membersR] = await env.DB.batch([
    env.DB.prepare("SELECT id, owner, text, at_text FROM todo_shares WHERE id = ?").bind(id),
    env.DB.prepare("SELECT user_id FROM todo_share_members WHERE share_id = ?").bind(id),
  ]);
  const share = shareR.results[0] as Share | undefined;
  const members = (membersR.results as { user_id: string }[]).map((r) => r.user_id);
  return share && members.includes(userId) ? { share, members } : null;
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const found = await load(env, me.id, params);
  if (!found) return json({ error: "없는 할 일이에요" }, 404);
  const { share, members } = found;
  const b = await readJson<{ at: unknown; members: unknown }>(request);
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  let added: string[] = [];
  if (Array.isArray(b.members)) {
    if (share.owner !== me.id) return json({ error: "사람은 만든 사람만 넣고 빼요" }, 403);
    const allowed = new Set((await shareablePeople(env, me.id)).map((p) => p.id));
    const want = [...new Set(b.members.filter((m): m is string => typeof m === "string" && m !== me.id))];
    // 이미 함께 하는 사람은 그대로 두고, 새로 넣는 사람만 고를 수 있는 사람인지 본다
    const next = want.filter((m) => members.includes(m) || allowed.has(m));
    if (!next.length) return json({ error: "함께 할 사람을 골라 주세요" }, 400);
    if (next.length > MAX_SHARE_MEMBERS) return json({ error: `함께 할 사람은 ${MAX_SHARE_MEMBERS}명까지예요` }, 400);
    added = next.filter((m) => !members.includes(m));
    const removed = members.filter((m) => m !== me.id && !next.includes(m));
    for (const m of removed) stmts.push(env.DB.prepare("DELETE FROM todo_share_members WHERE share_id = ? AND user_id = ?").bind(share.id, m));
    added.forEach((m, i) => stmts.push(env.DB.prepare("INSERT INTO todo_share_members (share_id, user_id, added_at) VALUES (?, ?, ?)").bind(share.id, m, now + i)));
  }
  const at = "at" in b ? cleanText(b.at, 20) : share.at_text;
  const atChanged = at !== share.at_text;
  stmts.push(env.DB.prepare("UPDATE todo_shares SET at_text = ?, updated_at = ? WHERE id = ?").bind(at, now, share.id));
  await env.DB.batch(stmts);
  const what = `${share.text}${at ? ` · ${at}` : ""}`;
  if (added.length) await notify(env, added, "todo", `${me.id}님이 함께 하재요: ${what}`, "#/todo", me.id);
  if (atChanged) {
    const others = members.filter((m) => m !== me.id && !added.includes(m));
    await notify(env, others, "todo", `${me.id}님이 언제를 바꿨어요: ${what}`, "#/todo", me.id);
  }
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const found = await load(env, me.id, params);
  if (!found) return json({ error: "없는 할 일이에요" }, 404);
  if (found.share.owner === me.id) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM todo_share_members WHERE share_id = ?").bind(found.share.id),
      env.DB.prepare("DELETE FROM todo_shares WHERE id = ?").bind(found.share.id),
    ]);
  } else {
    await env.DB.prepare("DELETE FROM todo_share_members WHERE share_id = ? AND user_id = ?").bind(found.share.id, me.id).run();
  }
  return json({ ok: true });
};
