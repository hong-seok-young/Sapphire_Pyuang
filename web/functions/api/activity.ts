// POST /api/activity { path } -> 지금 보는 화면을 사용 기록에 남긴다 (로그인한 길드원 누구나, 화면이 알아서 보낸다)
// POST /api/activity { open: true } -> 접속 하나 (웹이나 앱을 닫았다가 다시 열었을 때 화면이 한 번 보낸다)
// GET  /api/activity?user=&kind=&before= -> 사용 기록 보기 (앱개발자만, 제작자 요청): 최근 기록과 사람별 요약
//      (7일, 30일 접속 수, 7일 화면 수와 한 일 수, 마지막으로 쓴 때와 곳). before 를 주면 그보다 앞의 기록만.
//      부캐 묶기: 사람별 요약은 같은 사람의 캐릭터를 합쳐 본캐 한 줄로 (alts 에 부캐), user 로 고르면 그 사람의 모든 캐릭터 기록 (제작자 요청 2026-11-01)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../server/auth";
import type { Env } from "../../server/auth";
import { record, whereOf } from "../../server/activity";

const PAGE = 150;

interface Stat {
  id: string;
  role: string;
  main_id: string | null;
  visits7: number;
  visits30: number;
  views7: number;
  acts7: number;
  last: number | null;
  lastVia: string | null;
}
const DAY = 86_400_000;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const { path, open } = await readJson<{ path: unknown; open: unknown }>(request);
  if (open === true) {
    await record(env, me.id, "visit", "open", null, whereOf(request));
    return json({ ok: true });
  }
  if (typeof path !== "string" || !path.startsWith("#/") || path.length > 200) return json({ error: "화면 주소가 맞지 않아요" }, 400);
  await record(env, me.id, "view", path, null, whereOf(request));
  return json({ ok: true });
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (me.role !== "developer") return FORBIDDEN();
  const q = new URL(request.url).searchParams;
  const where: string[] = [];
  const binds: (string | number)[] = [];
  const user = q.get("user");
  if (user) {
    const owner = "(SELECT COALESCE(main_id, id) FROM users WHERE id = ?1)";
    where.push(`user_id IN (SELECT id FROM users WHERE id = ${owner} OR main_id = ${owner})`);
    binds.push(user);
  }
  const kind = q.get("kind");
  if (kind === "visit" || kind === "view" || kind === "act") {
    where.push("kind = ?");
    binds.push(kind);
  }
  const before = Number(q.get("before"));
  if (Number.isInteger(before) && before > 0) {
    where.push("id < ?");
    binds.push(before);
  }
  const rows = await env.DB.prepare(
    "SELECT id, user_id AS user, kind, what, detail, via, ip, place, device, at FROM activity" +
      (where.length ? " WHERE " + where.join(" AND ") : "") + ` ORDER BY id DESC LIMIT ${PAGE}`,
  )
    .bind(...binds)
    .all();
  const more = rows.results.length === PAGE;
  if (before > 0) return json({ rows: rows.results, more });
  const now = Date.now();
  const people = await env.DB.prepare(
    "SELECT u.id AS id, u.role AS role, u.main_id AS main_id, " +
      "(SELECT COUNT(*) FROM activity a WHERE a.user_id = u.id AND a.kind = 'visit' AND a.at > ?1) AS visits7, " +
      "(SELECT COUNT(*) FROM activity a WHERE a.user_id = u.id AND a.kind = 'visit' AND a.at > ?2) AS visits30, " +
      "(SELECT COUNT(*) FROM activity a WHERE a.user_id = u.id AND a.kind = 'view' AND a.at > ?1) AS views7, " +
      "(SELECT COUNT(*) FROM activity a WHERE a.user_id = u.id AND a.kind = 'act' AND a.at > ?1) AS acts7, " +
      "(SELECT MAX(a.at) FROM activity a WHERE a.user_id = u.id) AS last, " +
      "(SELECT a.via FROM activity a WHERE a.user_id = u.id ORDER BY a.at DESC LIMIT 1) AS lastVia " +
      "FROM users u ORDER BY last IS NULL, last DESC, u.id",
  )
    .bind(now - 7 * DAY, now - 30 * DAY)
    .all<Stat>();
  // 같은 사람의 캐릭터는 본캐 한 줄로 합친다 (마지막으로 쓴 때 순서는 그대로)
  const byOwner = new Map<string, Stat & { alts: string[] }>();
  for (const p of people.results) if (!p.main_id) byOwner.set(p.id, { ...p, alts: [] });
  for (const p of people.results) {
    if (!p.main_id) continue;
    const o = byOwner.get(p.main_id);
    if (!o) {
      byOwner.set(p.id, { ...p, alts: [] });
      continue;
    }
    o.alts.push(p.id);
    o.visits7 += p.visits7;
    o.visits30 += p.visits30;
    o.views7 += p.views7;
    o.acts7 += p.acts7;
    if (p.last !== null && (o.last === null || p.last > o.last)) {
      o.last = p.last;
      o.lastVia = p.lastVia;
    }
  }
  const merged = [...byOwner.values()]
    .map(({ main_id: _m, ...p }) => p)
    .sort((a, b) => (a.last === null ? 1 : 0) - (b.last === null ? 1 : 0) || (b.last ?? 0) - (a.last ?? 0) || a.id.localeCompare(b.id));
  return json({ rows: rows.results, more, people: merged });
};
