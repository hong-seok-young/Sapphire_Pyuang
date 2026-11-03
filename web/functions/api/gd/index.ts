// 길드 던전 (server/gdungeon.ts, 제작자 요청 2026-11-02, 1군 전용)
// GET  /api/gd -> { week, end, now, party(내 파티 상태), mine(내 이번 주 가능한 때), prev(지난주 것), parties(모든 파티 요약), people(넣을 수 있는 1군), staff }
//      파티 명단을 숨긴 동안(server/gdungeon.ts GD_PARTIES_OPEN = false, 제작자 2026-11-03 '공지 후 반영')은 미리 보는 사람이 아니면
//      hidden: true 와 내 시간표(mine, prev)만 주고 party·parties·people 은 비운다. 화면은 내 시간표와 안내 한 줄만 그린다
// POST /api/gd { members } -> 파티 만들기 (만든 사람이 파티장, 나 빼고 3명까지. 이름은 파티장 닉네임으로 'OO 팀')
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { MAX_MEMBERS, allParties, canSeeParties, canUseGd, gdPeople, memberProblem, partyIdOf, teamName, weeks } from "../../../server/gdungeon";
import { notify } from "../../../server/alerts";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!(await canUseGd(env, me))) return json({ error: "1군 전용이에요" }, 403);
  const now = Date.now();
  const { week, prev, end } = weeks(now);
  const hidden = !canSeeParties(me);
  const [parties, mineR, people] = await Promise.all([
    hidden ? [] : allParties(env, week, now),
    env.DB.prepare("SELECT week, slots FROM gd_avail WHERE user_id = ? AND week IN (?, ?)").bind(me.id, week, prev).all<{ week: number; slots: string }>(),
    hidden ? [] : gdPeople(env, me),
  ]);
  const mine = mineR.results.find((r) => r.week === week)?.slots ?? null;
  const prevMine = mineR.results.find((r) => r.week === prev)?.slots ?? null;
  if (hidden) return json({ week, end, now, hidden: true, party: null, mine, prev: prevMine, parties: [], people: [], staff: false }, 200, { "cache-control": "no-store" });
  const myParty = parties.find((p) => p.members.some((m) => m.id === me.id)) ?? null;
  return json(
    {
      week,
      end,
      now,
      party: myParty,
      mine,
      prev: prevMine,
      // 다른 파티는 이름, 파티원, 정한 때만
      parties: parties.map((p) => ({ id: p.id, name: p.name, leader: p.leader, stage: p.stage, members: p.members.map((m) => m.id), confirmed: p.confirmed, current: p.current })),
      people,
      staff: RANK[me.role] >= 1,
    },
    200,
    { "cache-control": "no-store" },
  );
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!(await canUseGd(env, me))) return FORBIDDEN();
  if (!canSeeParties(me)) return json({ error: "파티 명단은 운영진이 공지한 뒤에 열려요" }, 403);
  const b = await readJson<{ members: unknown }>(request);
  const name = teamName(me.id);
  const others = Array.isArray(b.members) ? [...new Set(b.members.filter((x): x is string => typeof x === "string" && x !== me.id))] : [];
  if (others.length > MAX_MEMBERS - 1) return json({ error: `파티는 ${MAX_MEMBERS}명까지예요` }, 400);
  if (await partyIdOf(env, me.id)) return json({ error: "이미 파티에 있어요" }, 409);
  const problem = await memberProblem(env, others, null);
  if (problem) return json({ error: problem }, 409);
  const now = Date.now();
  const r = await env.DB.prepare("INSERT INTO gd_parties (name, leader, created_at) VALUES (?, ?, ?)").bind(name, me.id, now).run();
  const id = Number(r.meta.last_row_id);
  try {
    await env.DB.batch([me.id, ...others].map((u) => env.DB.prepare("INSERT INTO gd_members (user_id, party_id, joined_at) VALUES (?, ?, ?)").bind(u, id, now)));
  } catch {
    // 그 사이 다른 파티에 들어간 사람이 있다: 만든 파티를 지운다
    await env.DB.batch([env.DB.prepare("DELETE FROM gd_members WHERE party_id = ?").bind(id), env.DB.prepare("DELETE FROM gd_parties WHERE id = ?").bind(id)]);
    return json({ error: "그 사이 다른 파티에 들어간 사람이 있어요. 다시 골라 주세요" }, 409);
  }
  await notify(env, others, "gdungeon", `${name}에 들어왔어요 (파티장 ${me.id}) · 이번 주 시간표를 칠해 주세요`, "#/match", me.id);
  return json({ id });
};
