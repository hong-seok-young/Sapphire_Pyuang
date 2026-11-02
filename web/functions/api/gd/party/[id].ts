// PUT    /api/gd/party/:id { name?, add?, remove?, leader? } -> 파티 고치기 (파티장, 운영진). 4명까지
// PUT    /api/gd/party/:id { leave: true } -> 파티 나가기 (파티원 누구나. 파티장이 나가면 다음 사람이 파티장, 아무도 없으면 파티를 지운다)
// DELETE /api/gd/party/:id -> 파티 지우기 (파티장, 운영진)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_MEMBERS, canManageParty, canUseGd, memberProblem, oneParty, weeks } from "../../../../server/gdungeon";
import { notify } from "../../../../server/alerts";

const strs = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x))] : []);

async function load(env: Env, id: number) {
  const p = await env.DB.prepare("SELECT id, name, leader FROM gd_parties WHERE id = ?").bind(id).first<{ id: number; name: string; leader: string }>();
  if (!p) return null;
  const { results } = await env.DB.prepare("SELECT user_id FROM gd_members WHERE party_id = ? ORDER BY joined_at, user_id").bind(id).all<{ user_id: string }>();
  return { ...p, members: results.map((r) => r.user_id) };
}

/** 사람이 없는 파티는 지우고, 파티장이 빠졌으면 먼저 들어온 사람에게 넘긴다 */
async function tidy(env: Env, id: number) {
  const p = await load(env, id);
  if (!p) return;
  if (!p.members.length) {
    await env.DB.batch([env.DB.prepare("DELETE FROM gd_answers WHERE party_id = ?").bind(id), env.DB.prepare("DELETE FROM gd_parties WHERE id = ?").bind(id)]);
  } else if (!p.members.includes(p.leader)) {
    await env.DB.prepare("UPDATE gd_parties SET leader = ? WHERE id = ?").bind(p.members[0], id).run();
  }
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!(await canUseGd(env, me))) return FORBIDDEN();
  const id = Number(params.id);
  const p = await load(env, id);
  if (!p) return json({ error: "없는 파티예요" }, 404);
  const b = await readJson<{ name: unknown; add: unknown; remove: unknown; leader: unknown; leave: unknown }>(request);
  const now = Date.now();

  if (b.leave === true) {
    if (!p.members.includes(me.id)) return json({ error: "이 파티에 없어요" }, 400);
    await env.DB.prepare("DELETE FROM gd_members WHERE user_id = ? AND party_id = ?").bind(me.id, id).run();
    await tidy(env, id);
    await notify(env, p.members.filter((x) => x !== me.id), "gdungeon", `[${p.name}] ${me.id} 님이 파티를 나갔어요`, "#/match", me.id);
    return json({ ok: true });
  }

  if (!canManageParty(me, p.leader)) return FORBIDDEN();
  const add = strs(b.add).filter((x) => !p.members.includes(x));
  const remove = strs(b.remove).filter((x) => p.members.includes(x));
  const size = p.members.length + add.length - remove.length;
  if (size > MAX_MEMBERS) return json({ error: `파티는 ${MAX_MEMBERS}명까지예요` }, 400);
  const problem = await memberProblem(env, add, id);
  if (problem) return json({ error: problem }, 409);
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 20) : p.name;
  const leader = typeof b.leader === "string" && p.members.includes(b.leader) && !remove.includes(b.leader) ? b.leader : p.leader;
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE gd_parties SET name = ?, leader = ? WHERE id = ?").bind(name, leader, id),
      ...remove.map((u) => env.DB.prepare("DELETE FROM gd_members WHERE user_id = ? AND party_id = ?").bind(u, id)),
      ...add.map((u) => env.DB.prepare("INSERT INTO gd_members (user_id, party_id, joined_at) VALUES (?, ?, ?)").bind(u, id, now)),
    ]);
  } catch {
    return json({ error: "그 사이 다른 파티에 들어간 사람이 있어요" }, 409);
  }
  await tidy(env, id);
  if (add.length) await notify(env, add, "gdungeon", `${name}에 들어왔어요 (파티장 ${leader}) · 이번 주 가능한 때를 칠해 주세요`, "#/match", me.id);
  if (remove.length) await notify(env, remove, "gdungeon", `${p.name}에서 빠졌어요`, "#/match", me.id);
  if (leader !== p.leader) await notify(env, [leader], "gdungeon", `${name}의 파티장이 됐어요`, "#/match", me.id);
  return json({ ok: true, party: await oneParty(env, id, weeks(now).week, now) });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!(await canUseGd(env, me))) return FORBIDDEN();
  const id = Number(params.id);
  const p = await load(env, id);
  if (!p) return json({ error: "없는 파티예요" }, 404);
  if (!canManageParty(me, p.leader)) return FORBIDDEN();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM gd_answers WHERE party_id = ?").bind(id),
    env.DB.prepare("DELETE FROM gd_members WHERE party_id = ?").bind(id),
    env.DB.prepare("DELETE FROM gd_parties WHERE id = ?").bind(id),
  ]);
  await notify(env, p.members.filter((x) => x !== me.id), "gdungeon", `${p.name}를 지웠어요`, "#/match", me.id);
  return json({ ok: true });
};
