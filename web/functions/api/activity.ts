// POST /api/activity { path } -> 지금 보는 화면을 사용 기록에 남긴다 (로그인한 길드원 누구나, 화면이 알아서 보낸다)
// POST /api/activity { open: true } -> 접속 하나 (웹이나 앱을 닫았다가 다시 열었을 때 화면이 한 번 보낸다)
// GET  /api/activity?user=&kind=&before= -> 사용 기록 보기 (앱개발자만, 제작자 요청): 최근 기록과 사람별 요약
//      (7일, 30일 접속 수, 7일 화면 수와 한 일 수, 마지막으로 쓴 때와 곳). before 를 주면 그보다 앞의 기록만.
//      부캐 묶기: 사람별 요약은 같은 사람의 캐릭터를 합쳐 본캐 한 줄로 (alts 에 부캐), user 로 고르면 그 사람의 모든 캐릭터 기록 (제작자 요청 2026-11-01)
//      기기 (제작자 요청 2026-11-02: 'IP 가 바뀌면 아이디를 빌려준 거냐'. IP 는 데이터·와이파이, 통신사가 수시로 바꿔서 그것만으로는 모른다):
//      사람마다 7일 동안 쓴 기기 수(devices7), 7일 안에 처음 나온 기기(newDev, 전에 쓰던 다른 기기가 있을 때만),
//      같은 때(10분 안) 다른 기기가 다른 도시에서 쓴 번 수(together). user 로 고르면 그 사람의 기기 목록(devices, 60일).
//      기기는 화면이 보내는 기기 표(activity.dev)로 가린다. 기기 표가 없던 예전 기록은 기기 글(device)로 묶어 목록에만 보인다
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../server/auth";
import type { Env } from "../../server/auth";
import { record, whereOf } from "../../server/activity";

const PAGE = 150;
/** 같은 때로 보는 사이, 기기 목록을 보는 기간 */
const TOGETHER_MS = 10 * 60_000;
const DEVICE_DAYS = 60;

/** 'Seoul, Seoul, KR' -> 'Seoul' (도시만 견준다) */
const cityOf = (place: string | null) => (place ? place.split(",")[0].trim() : "");

interface DevRow {
  user: string;
  k: string;
  dev: string | null;
  name: string | null;
  first: number;
  last: number;
  visits: number;
  n: number;
  /** 도시들 (쉼표로) */
  places: string | null;
}

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

/**
 * 게시판 글과 아이모 소식 글을 본 기록에는 그 글 제목을 같이 남긴다 (제작자 요청 2026-11-02: '게시판 들어간 사람이 그 안에서 뭘 봤는지까지').
 * 글 번호로 한 줄만 읽는다. 지운 글이면 비운다
 */
async function viewTitle(env: Env, path: string): Promise<string | null> {
  const m = /^#\/(board|official)\/(\d+)(?:$|[/?])/.exec(path);
  if (!m || m[0].endsWith("/")) return null;
  const table = m[1] === "board" ? "board_posts" : "official_news";
  try {
    const row = await env.DB.prepare(`SELECT title FROM ${table} WHERE id = ?`).bind(Number(m[2])).first<{ title: string }>();
    return row?.title ? row.title.slice(0, 120) : null;
  } catch {
    return null;
  }
}

/**
 * DB 를 무엇이 얼마나 쓰는지 (사용 기록 화면의 '자세히', 앱개발자만. 무료 500MB 안에서 쓰려고, 제작자 2026-11-02 '무조건 무료로').
 * 사진·첨부, 공식 소식, 챗봇 대화는 실제 바이트를 더하고, 사용 기록은 건수 x 최근 2000건의 평균 크기(색인 몫 더해서)로 어림한다
 */
async function usage(env: Env) {
  const r = await env.DB.prepare(
    "SELECT " +
      "(SELECT COALESCE(SUM(length(data)), 0) FROM board_files) AS files, " +
      "(SELECT COALESCE(SUM(length(data)), 0) FROM listing_shots) AS shots, " +
      "(SELECT COALESCE(SUM(length(png)), 0) FROM avatars) AS avatars, " +
      "(SELECT COALESCE(SUM(length(CAST(body AS BLOB)) + COALESCE(length(CAST(html AS BLOB)), 0)), 0) FROM official_news) AS official, " +
      "(SELECT COALESCE(SUM(length(CAST(text AS BLOB)) + COALESCE(length(CAST(thinking AS BLOB)), 0)), 0) FROM chat_msgs) AS chat, " +
      "(SELECT COALESCE(MAX(id), 0) FROM activity) AS actRows, " +
      "(SELECT AVG(length(CAST(what AS BLOB)) + COALESCE(length(CAST(detail AS BLOB)), 0) + COALESCE(length(ip), 0) + COALESCE(length(CAST(place AS BLOB)), 0) + " +
      "COALESCE(length(device), 0) + COALESCE(length(dev), 0) + length(CAST(user_id AS BLOB)) * 2 + 60) FROM (SELECT * FROM activity ORDER BY id DESC LIMIT 2000)) AS actAvg",
  ).all<{ files: number; shots: number; avatars: number; official: number; chat: number; actRows: number; actAvg: number | null }>();
  const u = r.results[0];
  const total = (r.meta as { size_after?: number } | undefined)?.size_after ?? null;
  const parts = [
    { name: "게시판 사진·첨부", bytes: u.files },
    { name: "사용 기록", bytes: Math.round(u.actRows * (u.actAvg ?? 0)) },
    { name: "공식 소식 본문", bytes: u.official },
    { name: "챗봇 대화", bytes: u.chat },
    { name: "중개인 스샷", bytes: u.shots },
    { name: "캐릭터 사진", bytes: u.avatars },
  ];
  return { total, limit: 500 * 1024 * 1024, parts };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const { path, open } = await readJson<{ path: unknown; open: unknown }>(request);
  if (open === true) {
    await record(env, me.id, "visit", "open", null, whereOf(request));
    return json({ ok: true });
  }
  if (typeof path !== "string" || !path.startsWith("#/") || path.length > 200) return json({ error: "화면 주소가 맞지 않아요" }, 400);
  await record(env, me.id, "view", path, await viewTitle(env, path), whereOf(request));
  return json({ ok: true });
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (me.role !== "developer") return FORBIDDEN();
  const q = new URL(request.url).searchParams;
  if (q.get("usage")) return json(await usage(env));
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
  // 쌓인 기록 수(지우지 않아 번호가 곧 수)와 DB 크기 (제작자 2026-11-02 '사용 기록 무제한으로 못 쌓아?': 무료 요금제는 DB 하나에 500MB 까지)
  const top = await env.DB.prepare("SELECT MAX(id) AS n FROM activity").first<{ n: number | null }>();
  const storage = { rows: top?.n ?? 0, bytes: (rows.meta as { size_after?: number } | undefined)?.size_after ?? null };
  const devices = user ? await devicesOf(env, user) : undefined;
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
  const flags = await deviceFlags(env, people.results);
  const merged = [...byOwner.values()]
    .map(({ main_id: _m, ...p }) => ({ ...p, ...(flags.get(p.id) ?? { devices7: 0, newDev: false, together: 0 }) }))
    .sort((a, b) => (a.last === null ? 1 : 0) - (b.last === null ? 1 : 0) || (b.last ?? 0) - (a.last ?? 0) || a.id.localeCompare(b.id));
  return json({ rows: rows.results, more, people: merged, devices, storage });
};

/** 기기마다 묶은 기록 (사람의 모든 캐릭터, 최근 60일). 기기 표가 없던 예전 기록은 기기 글로 */
async function deviceRows(env: Env, since: number, owner?: string): Promise<DevRow[]> {
  const who = owner
    ? " AND user_id IN (SELECT id FROM users WHERE id = (SELECT COALESCE(main_id, id) FROM users WHERE id = ?2) OR main_id = (SELECT COALESCE(main_id, id) FROM users WHERE id = ?2))"
    : "";
  const r = await env.DB.prepare(
    "SELECT user_id AS user, COALESCE(dev, 'ua:' || COALESCE(device, '?')) AS k, MAX(dev) AS dev, MAX(device) AS name, MIN(at) AS first, MAX(at) AS last, " +
      "SUM(kind = 'visit') AS visits, COUNT(*) AS n, " +
      // 도시만 (place 는 'Seoul, Seoul, KR')
      "GROUP_CONCAT(DISTINCT CASE WHEN instr(place, ',') > 0 THEN substr(place, 1, instr(place, ',') - 1) ELSE place END) AS places FROM activity WHERE at > ?1" + who +
      " GROUP BY user_id, k",
  )
    .bind(...(owner ? [since, owner] : [since]))
    .all<DevRow>();
  return r.results;
}

/** 고른 사람의 기기 목록: 같은 기기는 캐릭터를 합쳐 한 줄, 마지막으로 쓴 것부터 */
async function devicesOf(env: Env, user: string) {
  const now = Date.now();
  const rows = await deviceRows(env, now - DEVICE_DAYS * DAY, user);
  const byKey = new Map<string, DevRow & { chars: Set<string>; cities: Set<string> }>();
  for (const r of rows) {
    const cur = byKey.get(r.k);
    const cities = new Set((r.places ?? "").split(",").map((c) => c.trim()).filter(Boolean));
    if (!cur) byKey.set(r.k, { ...r, chars: new Set([r.user]), cities });
    else {
      cur.first = Math.min(cur.first, r.first);
      cur.last = Math.max(cur.last, r.last);
      cur.visits += r.visits;
      cur.n += r.n;
      cur.name = cur.name ?? r.name;
      cur.chars.add(r.user);
      for (const c of cities) cur.cities.add(c);
    }
  }
  const list = [...byKey.values()];
  // 기기 표가 있는 기기 중 가장 먼저 나온 때 (그보다 7일 넘게 뒤에 처음 나온 기기가 '새 기기')
  const firstDev = Math.min(...list.filter((d) => d.dev).map((d) => d.first));
  return list
    .sort((a, b) => b.last - a.last)
    .map((d) => ({
      name: d.name,
      legacy: !d.dev,
      first: d.first,
      last: d.last,
      visits: d.visits,
      n: d.n,
      cities: [...d.cities].slice(0, 4),
      chars: [...d.chars],
      isNew: !!d.dev && d.first > now - 7 * DAY && d.first > firstDev,
    }));
}

/** 사람(본캐)마다 7일 동안의 기기 수, 새 기기, 같은 때 다른 곳 */
async function deviceFlags(env: Env, users: { id: string; main_id: string | null }[]) {
  const now = Date.now();
  const ownerOf = new Map(users.map((u) => [u.id, u.main_id ?? u.id]));
  const out = new Map<string, { devices7: number; newDev: boolean; together: number }>();
  const get = (o: string) => out.get(o) ?? (out.set(o, { devices7: 0, newDev: false, together: 0 }), out.get(o)!);
  // 기기 수와 새 기기 (기기 표가 있는 기록만: 예전 기록과 섞으면 모두 새 기기로 보인다)
  const firstOf = new Map<string, Map<string, number>>();
  const seen7 = new Map<string, Set<string>>();
  for (const r of await deviceRows(env, now - DEVICE_DAYS * DAY)) {
    if (!r.dev) continue;
    const o = ownerOf.get(r.user) ?? r.user;
    const m = firstOf.get(o) ?? (firstOf.set(o, new Map()), firstOf.get(o)!);
    m.set(r.dev, Math.min(m.get(r.dev) ?? Infinity, r.first));
    if (r.last > now - 7 * DAY) (seen7.get(o) ?? (seen7.set(o, new Set()), seen7.get(o)!)).add(r.dev);
  }
  for (const [o, s] of seen7) get(o).devices7 = s.size;
  for (const [o, m] of firstOf) {
    const firsts = [...m.values()];
    const oldest = Math.min(...firsts);
    if (firsts.some((t) => t > now - 7 * DAY && t > oldest)) get(o).newDev = true;
  }
  // 같은 때 다른 곳: 7일 동안, 서로 다른 기기가 10분 안에 서로 다른 도시에서 (한 번 겹치면 30분은 한 번으로)
  const ev = await env.DB.prepare("SELECT user_id AS user, dev, place, at FROM activity WHERE at > ? AND dev IS NOT NULL ORDER BY at")
    .bind(now - 7 * DAY)
    .all<{ user: string; dev: string; place: string | null; at: number }>();
  const lastBy = new Map<string, Map<string, { at: number; city: string }>>();
  const lastHit = new Map<string, number>();
  for (const e of ev.results) {
    const o = ownerOf.get(e.user) ?? e.user;
    const city = cityOf(e.place);
    const m = lastBy.get(o) ?? (lastBy.set(o, new Map()), lastBy.get(o)!);
    for (const [dev, l] of m) {
      if (dev !== e.dev && e.at - l.at < TOGETHER_MS && city && l.city && city !== l.city && e.at - (lastHit.get(o) ?? 0) > 30 * 60_000) {
        get(o).together++;
        lastHit.set(o, e.at);
      }
    }
    m.set(e.dev, { at: e.at, city });
  }
  return out;
}
