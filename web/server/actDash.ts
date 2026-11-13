// 사용 기록 대시보드 (제작자 2026-11-13 '사용기록 ui 싹 개편, 누가 웹과 챗봇 api 등 사용량이 많은가 대시보드, 차트와 그래픽 애니메이션',
// '로그인 횟수 등등 종합적으로 고려해서 잘 쓰는 사람과 안 쓰는 사람 정도로 보이게'). functions/api/activity.ts 의 part=dash · live · person.
//
// 무료 요금제의 하루 읽기 500만 줄을 아끼려고 지난 날은 한 번만 사용 기록 DB(2~10, server/logdb.ts)를 훑어 하루 요약(act_day_*)에 적고,
// 오늘은 그때그때 센다. 요약은 사람(캐릭터)·날마다 접속·화면·한 일·5분 칸 수(사용 시간), 시간대, 메뉴, 어디서(앱·웹).
// 사람은 부캐를 본캐로 합친다. 테스트 계정은 뺀다. 챗봇 질문 수는 chat_usage, AI 토큰은 api_usage(server/apiUsage.ts, 2026-11-13 부터).
import { TEST_IDS } from "./auth";
import type { Env, Role } from "./auth";
import { covering, fromLogs, logDbs } from "./logdb";
import type { LogDb } from "./logdb";
import { APP_USER, monthUsd, usdOf } from "./apiUsage";

const DAY = 86_400_000;
const KST = 9 * 3_600_000;
/** 한국 날짜 번호 */
export const dayOf = (t: number) => Math.floor((t + KST) / DAY);
const dayStart = (d: number) => d * DAY - KST;
/** 날짜 번호 <-> 'YYYY-MM-DD' (chat_usage, api_usage) */
const dayKey = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const keyDay = (s: string) => Math.floor(Date.parse(s) / DAY);
const DAYX = `((at + ${KST}) / ${DAY})`;
/** 한 번에 새로 요약하는 날 수 (처음 한 번 밀린 날이 많으면 몇 번에 나눠서) */
const FILL_MAX = 10;
/** 차트에 보이는 날 수 (기간의 두 배를 넉넉히: 지난 기간과 견준다) */
const HISTORY = 60;
/** 사용 기록이 생기기 전 (이보다 앞은 요약하지 않는다) */
const FIRST_DAY = dayOf(Date.UTC(2026, 9, 25) - KST);

interface UR { d: number; u: string; v: number; w: number; a: number; m: number }
interface HR { d: number; h: number; n: number; us: number }
interface SR { d: number; s: string; n: number; us: number }
interface VR { d: number; via: string; n: number; us: number }

/** [from, to) 의 사용 기록을 날마다 센다 (DB 마다 센 것을 더한다) */
async function aggregate(dbs: LogDb[], from: number, to: number) {
  const list = covering(dbs, from);
  const W = "WHERE at >= ?1 AND at < ?2";
  const run = <T>(sql: string) => fromLogs<T>(list, (db) => db.prepare(sql).bind(from, to));
  const [us, hs, ss, vs] = await Promise.all([
    run<UR>(
      `SELECT ${DAYX} AS d, user_id AS u, SUM(kind = 'visit') AS v, SUM(kind = 'view') AS w, SUM(kind = 'act') AS a, COUNT(DISTINCT at / 300000) AS m FROM activity ${W} GROUP BY d, u`,
    ),
    run<HR>(`SELECT ${DAYX} AS d, ((at + ${KST}) % ${DAY}) / 3600000 AS h, COUNT(*) AS n, COUNT(DISTINCT user_id) AS us FROM activity ${W} GROUP BY d, h`),
    // 메뉴: 화면은 주소 첫 칸('#/board?…' -> view:board), 한 일은 API 첫 칸('POST /api/market/3' -> act:market)
    run<SR>(
      "SELECT d, kind || ':' || substr(r, 1, min(CASE instr(r, '/') WHEN 0 THEN 99 ELSE instr(r, '/') END, CASE instr(r, '?') WHEN 0 THEN 99 ELSE instr(r, '?') END) - 1) AS s, " +
        `COUNT(*) AS n, COUNT(DISTINCT u) AS us FROM (SELECT ${DAYX} AS d, kind, user_id AS u, CASE kind WHEN 'view' THEN substr(what, 3) ELSE substr(what, instr(what, '/api/') + 5) END AS r ` +
        `FROM activity ${W} AND kind != 'visit') GROUP BY d, s`,
    ),
    run<VR>(`SELECT ${DAYX} AS d, COALESCE(via, '') AS via, COUNT(*) AS n, COUNT(DISTINCT user_id) AS us FROM activity ${W} GROUP BY d, COALESCE(via, '')`),
  ]);
  // 여러 DB 에 걸친 날은 더한다 (사람 수는 DB 가 바뀐 날만 조금 겹쳐 셀 수 있다)
  const sum = <T extends { n: number; us: number }>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T>();
    for (const r of rows) {
      const k = key(r);
      const o = m.get(k);
      if (o) {
        o.n += r.n;
        o.us += r.us;
      } else m.set(k, { ...r });
    }
    return [...m.values()];
  };
  const um = new Map<string, UR>();
  for (const r of us) {
    const k = r.d + "|" + r.u;
    const o = um.get(k);
    if (o) {
      o.v += r.v;
      o.w += r.w;
      o.a += r.a;
      o.m += r.m;
    } else um.set(k, { ...r });
  }
  return {
    users: [...um.values()],
    hours: sum(hs, (r) => r.d + "|" + r.h),
    secs: sum(ss, (r) => r.d + "|" + r.s),
    vias: sum(vs, (r) => r.d + "|" + r.via),
  };
}

/** 아직 요약 안 한 지난 날을 FILL_MAX 일까지 요약해 적는다. 남았으면 true */
async function fill(env: Env, dbs: LogDb[], want: number[]): Promise<boolean> {
  if (!want.length) return false;
  const done = new Set(
    (await env.DB.prepare("SELECT day FROM act_rollup WHERE day >= ? AND day <= ?").bind(want[0], want[want.length - 1]).all<{ day: number }>()).results.map((r) => r.day),
  );
  const miss = want.filter((d) => !done.has(d));
  if (!miss.length) return false;
  // 새 날부터 (차트 오른쪽이 먼저 찬다)
  const days = miss.slice(-FILL_MAX);
  const lo = days[0];
  const hi = days[days.length - 1];
  const agg = await aggregate(dbs, dayStart(lo), dayStart(hi + 1));
  const inDays = new Set(days);
  const pick = <T extends { d: number }>(rows: T[]) => rows.filter((r) => inDays.has(r.d));
  const j = (v: unknown) => JSON.stringify(v);
  const now = Date.now();
  const ins = (table: string, cols: string, n: number, rows: unknown[][]) =>
    env.DB.prepare(
      `INSERT OR REPLACE INTO ${table} (${cols}) SELECT ${Array.from({ length: n }, (_, i) => `json_extract(value, '$[${i}]')`).join(", ")} FROM json_each(?)`,
    ).bind(j(rows));
  await env.DB.batch([
    ins("act_day_user", "day, user_id, visits, views, acts, mins", 6, pick(agg.users).map((r) => [r.d, r.u, r.v, r.w, r.a, r.m])),
    ins("act_day_hour", "day, hour, n, users", 4, pick(agg.hours).map((r) => [r.d, r.h, r.n, r.us])),
    ins("act_day_sec", "day, sec, n, users", 4, pick(agg.secs).map((r) => [r.d, r.s.slice(0, 40), r.n, r.us])),
    ins("act_day_via", "day, via, n, users", 4, pick(agg.vias).map((r) => [r.d, r.via, r.n, r.us])),
    ins("act_rollup", "day, done_at", 2, days.map((d) => [d, now])),
  ]);
  return miss.length > days.length;
}

interface UserRow {
  id: string;
  role: Role;
  main_id: string | null;
}

/** 잘 쓰는 사람 점수 (0~100): 들어온 날, 사용 시간, 접속(로그인) 수, 한 일, 챗봇 질문을 하루 기준으로 견준다 */
export function scoreOf(p: { days: number; v: number; m: number; a: number; q: number }, period: number): number {
  const per = Math.max(1, period);
  const r = (x: number, full: number) => Math.min(1, x / (full * per));
  return Math.round(100 * (0.4 * r(p.days, 1) + 0.25 * r(p.m * 5, 30) + 0.15 * r(p.v, 2) + 0.1 * r(p.a, 3) + 0.1 * r(p.q, 1)));
}

/**
 * 대시보드: days 일(오늘 포함) 기간과 그 앞 같은 기간, 60일 일별 추이, 시간대(요일 x 시), 메뉴, 어디서, 사람마다 합과 점수, AI 사용량.
 * partial 이면 지난 날 요약이 남아서 화면이 한 번 더 부른다
 */
export async function dashboard(env: Env, period: number) {
  const now = Date.now();
  const today = dayOf(now);
  const dbs = await logDbs(env);
  const histFrom = Math.max(FIRST_DAY, today - Math.max(HISTORY, period * 2) + 1);
  const past: number[] = [];
  // 끝난 지 10분 넘은 날만 요약한다 (자정 바로 뒤에 늦게 쓰인 기록)
  const lastDone = dayOf(now - 10 * 60_000) - 1;
  for (let d = histFrom; d <= lastDone; d++) past.push(d);
  const partial = await fill(env, dbs, past);
  const liveFrom = dayStart(lastDone + 1);

  const [live, uRows, hRows, sRows, vRows, users, chat, api, lastRows, aiMonth] = await Promise.all([
    aggregate(dbs, liveFrom, now + 60_000),
    env.DB.prepare("SELECT day AS d, user_id AS u, visits AS v, views AS w, acts AS a, mins AS m FROM act_day_user WHERE day >= ?").bind(histFrom).all<UR>(),
    env.DB.prepare("SELECT day AS d, hour AS h, n, users AS us FROM act_day_hour WHERE day > ?").bind(today - Math.max(period, 8)).all<HR>(),
    env.DB.prepare("SELECT day AS d, sec AS s, n, users AS us FROM act_day_sec WHERE day > ?").bind(today - period).all<SR>(),
    env.DB.prepare("SELECT day AS d, via, n, users AS us FROM act_day_via WHERE day > ?").bind(today - period).all<VR>(),
    env.DB.prepare("SELECT id, role, main_id FROM users").all<UserRow>(),
    env.DB.prepare("SELECT user_id AS u, day, count FROM chat_usage WHERE day >= ?").bind(dayKey(histFrom)).all<{ u: string; day: string; count: number }>(),
    env.DB.prepare(
      "SELECT user_id AS u, day, kind, calls, input, output, cache_read AS cr, cache_write AS cw, web FROM api_usage WHERE day >= ?",
    ).bind(dayKey(histFrom)).all<{ u: string; day: string; kind: string; calls: number; input: number; output: number; cr: number; cw: number; web: number }>(),
    // 마지막으로 들어온 날 (요약 전체에서, 잠수 며칠째)
    env.DB.prepare("SELECT user_id AS u, MAX(day) AS d FROM act_day_user GROUP BY user_id").all<{ u: string; d: number }>(),
    // 이번 달 AI 비용 (달러, 콘솔 값 기준 어림)
    monthUsd(env).catch(() => null),
  ]);

  const ownerOf = new Map(users.results.map((u) => [u.id, u.main_id ?? u.id]));
  const skip = (id: string) => TEST_IDS.includes(id) || id === APP_USER;
  const owner = (id: string) => ownerOf.get(id) ?? id;
  const allUsers = [...uRows.results, ...live.users];
  const allHours = [...hRows.results, ...live.hours];
  const allSecs = [...sRows.results, ...live.secs.filter((r) => r.d > today - period)];
  const allVias = [...vRows.results, ...live.vias.filter((r) => r.d > today - period)];

  // 일별 (60일)
  const nDays = today - histFrom + 1;
  const daily = Array.from({ length: nDays }, (_, i) => ({ d: histFrom + i, users: 0, v: 0, w: 0, a: 0, m: 0, q: 0, tok: 0 }));
  const dayUsers = new Map<number, Set<string>>();
  for (const r of allUsers) {
    if (skip(r.u)) continue;
    const row = daily[r.d - histFrom];
    if (!row) continue;
    row.v += r.v;
    row.w += r.w;
    row.a += r.a;
    row.m += r.m;
    (dayUsers.get(r.d) ?? (dayUsers.set(r.d, new Set()), dayUsers.get(r.d)!)).add(owner(r.u));
  }
  for (const [d, s] of dayUsers) daily[d - histFrom].users = s.size;
  for (const r of chat.results) {
    const row = daily[keyDay(r.day) - histFrom];
    if (row && !skip(r.u)) row.q += r.count;
  }
  for (const r of api.results) {
    const row = daily[keyDay(r.day) - histFrom];
    if (row) row.tok += r.input + r.output + r.cr + r.cw;
  }

  // 사람마다: 이번 기간과 지난 기간
  const from = today - period + 1;
  const prevFrom = from - period;
  type P = { id: string; role: Role; alts: string[]; days: Set<number>; v: number; w: number; a: number; m: number; q: number; tok: number; tokIn: number; tokOut: number; web: number; calls: number; spark: number[]; prev: { days: Set<number>; v: number; w: number; a: number; m: number; q: number }; last: number | null };
  const people = new Map<string, P>();
  const roleOf = new Map(users.results.map((u) => [u.id, u.role]));
  const get = (id: string): P => {
    const o = owner(id);
    let p = people.get(o);
    if (!p) {
      p = { id: o, role: roleOf.get(o) ?? "member", alts: [], days: new Set(), v: 0, w: 0, a: 0, m: 0, q: 0, tok: 0, tokIn: 0, tokOut: 0, web: 0, calls: 0, spark: Array(period).fill(0), prev: { days: new Set(), v: 0, w: 0, a: 0, m: 0, q: 0 }, last: null };
      people.set(o, p);
    }
    if (id !== o && !p.alts.includes(id)) p.alts.push(id);
    return p;
  };
  // 계정이 있는 사람은 기록이 없어도 (잠수를 보려고)
  for (const u of users.results) if (!skip(u.id)) get(u.id);
  for (const r of allUsers) {
    if (skip(r.u)) continue;
    if (r.d >= from) {
      const p = get(r.u);
      p.days.add(r.d);
      p.v += r.v;
      p.w += r.w;
      p.a += r.a;
      p.m += r.m;
      p.spark[r.d - from] += r.w + r.a;
    } else if (r.d >= prevFrom) {
      const p = get(r.u).prev;
      p.days.add(r.d);
      p.v += r.v;
      p.w += r.w;
      p.a += r.a;
      p.m += r.m;
    }
  }
  for (const r of lastRows.results) if (!skip(r.u)) {
    const p = get(r.u);
    p.last = Math.max(p.last ?? 0, r.d);
  }
  for (const r of live.users) if (!skip(r.u)) {
    const p = get(r.u);
    p.last = Math.max(p.last ?? 0, r.d);
  }
  for (const r of chat.results) {
    if (skip(r.u)) continue;
    const d = keyDay(r.day);
    if (d >= from) get(r.u).q += r.count;
    else if (d >= prevFrom) get(r.u).prev.q += r.count;
  }
  // AI: 종류마다, 사람마다 (이번 기간)
  const kinds = new Map<string, { kind: string; calls: number; input: number; output: number; cache: number; web: number; usd: number; users: Set<string> }>();
  let aiSince: number | null = null;
  for (const r of api.results) {
    const d = keyDay(r.day);
    aiSince = aiSince === null ? d : Math.min(aiSince, d);
    if (d < from) continue;
    const k = kinds.get(r.kind) ?? (kinds.set(r.kind, { kind: r.kind, calls: 0, input: 0, output: 0, cache: 0, web: 0, usd: 0, users: new Set() }), kinds.get(r.kind)!);
    k.calls += r.calls;
    k.input += r.input;
    k.output += r.output;
    k.cache += r.cr + r.cw;
    k.web += r.web;
    k.usd += usdOf(r);
    k.users.add(owner(r.u));
    if (skip(r.u)) continue;
    const p = get(r.u);
    p.calls += r.calls;
    p.tokIn += r.input + r.cr + r.cw;
    p.tokOut += r.output;
    p.tok += r.input + r.output + r.cr + r.cw;
    p.web += r.web;
  }

  // 시간대: 요일(0 일요일) x 시
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const heatUsers = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const hDays = Math.max(period, 7);
  const hourly = { today: Array(24).fill(0) as number[], avg: Array(24).fill(0) as number[] };
  for (const r of allHours) {
    if (r.d === today) hourly.today[r.h] += r.n;
    else if (r.d > today - 8) hourly.avg[r.h] += r.n / 7;
    if (r.d <= today - hDays) continue;
    const w = (r.d + 4) % 7;
    heat[w][r.h] += r.n;
    heatUsers[w][r.h] += r.us;
  }
  const secs = new Map<string, { s: string; n: number; us: number }>();
  for (const r of allSecs) {
    const o = secs.get(r.s) ?? (secs.set(r.s, { s: r.s, n: 0, us: 0 }), secs.get(r.s)!);
    o.n += r.n;
    o.us += r.us;
  }
  const vias = new Map<string, { via: string; n: number; us: number }>();
  for (const r of allVias) {
    const o = vias.get(r.via) ?? (vias.set(r.via, { via: r.via, n: 0, us: 0 }), vias.get(r.via)!);
    o.n += r.n;
    o.us += r.us;
  }

  const span = Math.max(period, 7);
  const out = [...people.values()].map((p) => {
    const cur = { days: p.days.size, v: p.v, m: p.m, a: p.a, q: p.q };
    const prev = { days: p.prev.days.size, v: p.prev.v, m: p.prev.m, a: p.prev.a, q: p.prev.q };
    return {
      id: p.id,
      role: p.role,
      alts: p.alts,
      days: p.days.size,
      v: p.v,
      w: p.w,
      a: p.a,
      m: p.m,
      q: p.q,
      tok: p.tok,
      tokIn: p.tokIn,
      tokOut: p.tokOut,
      web: p.web,
      calls: p.calls,
      spark: p.spark,
      last: p.last,
      score: scoreOf(cur, period),
      // 점수가 하루짜리면 흔들려서, 잠수·핵심 구분은 7일 이상으로도 본다
      prevScore: scoreOf(prev, period),
      prev: { v: prev.v, w: p.prev.w, a: p.prev.a, m: p.prev.m, q: prev.q, days: prev.days },
    };
  });
  return {
    now,
    today,
    period,
    span,
    partial,
    daily,
    heat,
    heatUsers,
    heatDays: hDays,
    hourly,
    secs: [...secs.values()].sort((a, b) => b.n - a.n).slice(0, 40),
    vias: [...vias.values()].sort((a, b) => b.n - a.n),
    people: out,
    ai: [...kinds.values()].map((k) => ({ ...k, users: k.users.size })).sort((a, b) => b.calls - a.calls),
    aiSince,
    aiMonth,
  };
}

/** 지금 접속 중 (10분 안) 과 지난 60분 분마다 */
export async function liveNow(env: Env) {
  const now = Date.now();
  const dbs = covering(await logDbs(env), now - 60 * 60_000);
  const [last, minutes, users] = await Promise.all([
    fromLogs<{ u: string; at: number; kind: string; what: string; detail: string | null; via: string | null; n: number }>(dbs, (db) =>
      db
        .prepare(
          "SELECT a.user_id AS u, a.at AS at, a.kind AS kind, a.what AS what, a.detail AS detail, a.via AS via, m.n AS n FROM activity a " +
            "JOIN (SELECT user_id, MAX(id) AS id, COUNT(*) AS n FROM activity INDEXED BY activity_at WHERE at > ? GROUP BY user_id) m ON m.id = a.id",
        )
        .bind(now - 10 * 60_000),
    ),
    fromLogs<{ mi: number; n: number; us: number }>(dbs, (db) =>
      db.prepare("SELECT at / 60000 AS mi, COUNT(*) AS n, COUNT(DISTINCT user_id) AS us FROM activity INDEXED BY activity_at WHERE at > ? GROUP BY mi").bind(now - 60 * 60_000),
    ),
    env.DB.prepare("SELECT id, role, main_id FROM users").all<UserRow>(),
  ]);
  const ownerOf = new Map(users.results.map((u) => [u.id, u.main_id ?? u.id]));
  const byOwner = new Map<string, { id: string; char: string; at: number; kind: string; what: string; detail: string | null; via: string | null; n: number }>();
  for (const r of last) {
    if (TEST_IDS.includes(r.u)) continue;
    const o = ownerOf.get(r.u) ?? r.u;
    const cur = byOwner.get(o);
    if (!cur || r.at > cur.at) byOwner.set(o, { id: o, char: r.u, at: r.at, kind: r.kind, what: r.what, detail: r.kind === "act" ? null : r.detail, via: r.via, n: (cur?.n ?? 0) + r.n });
    else cur.n += r.n;
  }
  const base = Math.floor(now / 60_000) - 59;
  const perMin = Array(60).fill(0) as number[];
  for (const m of minutes) if (m.mi >= base) perMin[m.mi - base] += m.n;
  return { now, people: [...byOwner.values()].sort((a, b) => b.at - a.at), perMin };
}

/** 고른 사람의 기간: 날마다, 요일 x 시, 메뉴, 챗봇·AI, 최근 챗봇 질문 (그 사람의 모든 캐릭터) */
export async function personDash(env: Env, ids: string[], period: number) {
  const now = Date.now();
  const today = dayOf(now);
  const from = dayStart(today - period + 1);
  const dbs = covering(await logDbs(env), from);
  const idj = JSON.stringify(ids);
  const W = "WHERE user_id IN (SELECT value FROM json_each(?1)) AND at >= ?2";
  const run = <T>(sql: string) => fromLogs<T>(dbs, (db) => db.prepare(sql).bind(idj, from));
  const [days, hours, secs, asks, chat, api] = await Promise.all([
    run<{ d: number; v: number; w: number; a: number; m: number }>(
      `SELECT ${DAYX} AS d, SUM(kind = 'visit') AS v, SUM(kind = 'view') AS w, SUM(kind = 'act') AS a, COUNT(DISTINCT at / 300000) AS m FROM activity ${W} GROUP BY d`,
    ),
    run<{ wd: number; h: number; n: number }>(`SELECT (${DAYX} + 4) % 7 AS wd, ((at + ${KST}) % ${DAY}) / 3600000 AS h, COUNT(*) AS n FROM activity ${W} GROUP BY wd, h`),
    run<{ s: string; n: number }>(
      "SELECT kind || ':' || substr(r, 1, min(CASE instr(r, '/') WHEN 0 THEN 99 ELSE instr(r, '/') END, CASE instr(r, '?') WHEN 0 THEN 99 ELSE instr(r, '?') END) - 1) AS s, COUNT(*) AS n " +
        `FROM (SELECT kind, CASE kind WHEN 'view' THEN substr(what, 3) ELSE substr(what, instr(what, '/api/') + 5) END AS r FROM activity ${W} AND kind != 'visit') GROUP BY s`,
    ),
    run<{ detail: string | null; at: number }>(`SELECT detail, at FROM activity ${W} AND kind = 'act' AND what = 'POST /api/chat' ORDER BY at DESC LIMIT 8`),
    env.DB.prepare("SELECT day, SUM(count) AS n FROM chat_usage WHERE user_id IN (SELECT value FROM json_each(?1)) AND day >= ?2 GROUP BY day")
      .bind(idj, dayKey(today - period + 1))
      .all<{ day: string; n: number }>(),
    env.DB.prepare(
      "SELECT kind, SUM(calls) AS calls, SUM(input + cache_read + cache_write) AS input, SUM(output) AS output, SUM(web) AS web FROM api_usage WHERE user_id IN (SELECT value FROM json_each(?1)) AND day >= ?2 GROUP BY kind",
    )
      .bind(idj, dayKey(today - period + 1))
      .all<{ kind: string; calls: number; input: number; output: number; web: number }>(),
  ]);
  const daily = Array.from({ length: period }, (_, i) => ({ d: today - period + 1 + i, v: 0, w: 0, a: 0, m: 0, q: 0 }));
  for (const r of days) {
    const o = daily[r.d - (today - period + 1)];
    if (!o) continue;
    o.v += r.v;
    o.w += r.w;
    o.a += r.a;
    o.m += r.m;
  }
  for (const r of chat.results) {
    const o = daily[keyDay(r.day) - (today - period + 1)];
    if (o) o.q += r.n;
  }
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const r of hours) heat[r.wd][r.h] += r.n;
  const sm = new Map<string, number>();
  for (const r of secs) sm.set(r.s, (sm.get(r.s) ?? 0) + r.n);
  const questions = asks
    .sort((a, b) => b.at - a.at)
    .slice(0, 8)
    .map((r) => {
      try {
        const d = JSON.parse(r.detail ?? "{}") as { question?: unknown; photos?: unknown };
        return { at: r.at, text: typeof d.question === "string" ? d.question.slice(0, 200) : "", photos: Number(d.photos) || 0 };
      } catch {
        return { at: r.at, text: "", photos: 0 };
      }
    });
  return {
    period,
    today,
    daily,
    heat,
    secs: [...sm].map(([s, n]) => ({ s, n })).sort((a, b) => b.n - a.n).slice(0, 12),
    questions,
    ai: api.results,
  };
}
