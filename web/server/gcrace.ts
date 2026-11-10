// 2군 성장코인샵 시범운영: 주간 목표 레벨 선착순 (제작자·김다혜 2026-11-09, 유어아너 공지 2026-11-10 '격주: 일주일 하고 일주일 쉬고').
// '2주간의 목표 레벨은 담당자가 정해 주고, 월요일부터 다음 주 일요일까지가 기본 2주', '그 2주 동안 목표 레벨을 먼저 달성하면 1위, 선착순 제도',
// '1등부터 5등만 주는 걸로', '37렙 먼저 찍으면 5코인', '누군가 딱 달성하면 1위로 확정', '상점의 성장 카드는 달성률이 나오게, 그 달성률로 순위를 매기다가'.
// 판은 담당자가 정한 기간(그날 0시 ~ 끝 날 24시, D1 gc_rounds), 안 정했으면 2026-11-16(월) 0시부터 7일 진행하고 7일 쉰다 (제작자 2026-11-10 '00시부터, 월요일부터야 다음 주':
// 11/16(월) 0시 ~ 11/22(일) 24시, 쉬고, 11/30(월) 0시 ~ …). 끝난 판은 결과를 D1 gc_round_results 에 남긴다 (담당자 > 기록). 목표는 판마다 사람마다 (D1 gc_targets).
// 쉬는 주에는 끝난 판 결과를 보이고, 담당자가 정하는 목표는 다음 판 것이다 (targetRound).
// 달성은 길드 랭킹·내 정보에 적은 레벨 기록(level_log)에서 그 판 안에 처음 목표 레벨 이상을 적은 때로 센다 (게임을 읽지 않는다).
// 달성한 사람은 그때 순서대로 1위 2위 … (확정), 아직인 사람은 달성률 순. 1~5위는 달성하는 순간 상금(gc_settings rank1~5)이 지갑에 들어간다 (gc_ledger kind race).
import type { Env, User } from "./auth";
import { notify } from "./alerts";
import { canUseGcoin, gcoinOpen, isMember, readRank } from "./gcoin";

const DAY = 86_400_000;
/** 진행하는 날 수와 한 바퀴(진행 + 휴식): 담당자가 기간을 정하기 전의 기본 판 */
export const RACE_DAYS = 7;
export const RACE_CYCLE = 14;
/** 첫 판 시작 = 2026-11-16(월) 0시 한국 시간 (판은 늘 그날 0시부터) */
export const RACE_ANCHOR = Date.UTC(2026, 10, 15, 15);

/** 판 하나. id 는 처음 정한 시작 때로, 목표(gc_targets.round)와 상금 장부(ref 'race:<id>')가 이것으로 잇는다 (기간을 고쳐도 그대로) */
export interface Round {
  id: number;
  start: number;
  end: number;
}

/** 기본 판 (담당자가 기간을 정하기 전): 오픈 때부터 7일 진행, 7일 휴식 */
function defaultStart(now: number): number {
  const n = Math.max(0, Math.floor((now - RACE_ANCHOR) / (RACE_CYCLE * DAY)));
  return RACE_ANCHOR + n * RACE_CYCLE * DAY;
}
const defaultRound = (start: number): Round => ({ id: start, start, end: start + RACE_DAYS * DAY });

/**
 * 담당자가 정한 판들 (제작자 2026-11-10 '담당자 페이지에서 며칠 00시부터 며칠 24시까지 이벤트 기간 설정'). D1 gc_rounds, 시작 순.
 * 하나도 없으면 null (기본 판을 쓴다). 하나라도 정하면 정한 판만 쓴다 (마지막 판이 끝나고 다음 판을 안 정했으면 '다음 판 미정')
 */
export async function readRounds(env: Env): Promise<Round[] | null> {
  const { results } = await env.DB.prepare("SELECT id, start, end_at AS end FROM gc_rounds ORDER BY start").all<Round>();
  return results.length ? results : null;
}

/** 지금(또는 마지막) 판. 첫 판 전이면 첫 판 */
export async function currentRound(env: Env, now = Date.now(), rounds?: Round[] | null): Promise<Round> {
  const rs = rounds === undefined ? await readRounds(env) : rounds;
  if (!rs) return defaultRound(defaultStart(now));
  let cur = rs[0];
  for (const r of rs) if (r.start <= now) cur = r;
  return cur;
}
/** 지금 판이 끝난 뒤 다음 판 (안 정했으면 null) */
export async function nextRound(env: Env, now = Date.now(), rounds?: Round[] | null): Promise<Round | null> {
  const rs = rounds === undefined ? await readRounds(env) : rounds;
  const cur = await currentRound(env, now, rs);
  if (now < cur.end) return null;
  if (!rs) return defaultRound(cur.start + RACE_CYCLE * DAY);
  return rs.find((r) => r.start > now) ?? null;
}
/** 담당자가 목표를 정하는 판: 진행 중이거나 첫 판 전이면 그 판, 끝났으면 다음 판 (안 정했으면 null) */
export async function targetRound(env: Env, now = Date.now(), rounds?: Round[] | null): Promise<Round | null> {
  const rs = rounds === undefined ? await readRounds(env) : rounds;
  const cur = await currentRound(env, now, rs);
  return now < cur.end ? cur : nextRound(env, now, rs);
}

export interface RaceEntry {
  id: string;
  /** 목표를 정할 때 레벨과 목표 레벨 */
  fromLevel: number;
  target: number;
  /** 지금 레벨·경험치(% x 1000) */
  level: number;
  exp: number | null;
  job: string;
  avatar: number | null;
  highSpec: boolean;
  /** 목표를 처음 찍은 때 (아직이면 null) */
  doneAt: number | null;
  /** 달성률 0~100 (레벨 + 경험치로, 목표를 찍으면 100) */
  pct: number;
  /** 순위 (달성한 사람이 먼저, 그 안에서 찍은 순서) */
  rank: number;
  /** 1~5위 달성자의 상금 (아직 달성 전이면 0) */
  coins: number;
}

const pos = (level: number, exp: number | null) => level + (exp ?? 0) / 100_000;
export function progress(fromLevel: number, target: number, level: number, exp: number | null): number {
  if (target <= fromLevel) return 100;
  const p = ((pos(level, exp) - fromLevel) / (target - fromLevel)) * 100;
  return Math.max(0, Math.min(100, Math.floor(p * 10 + 1e-6) / 10));
}

/** 이 판의 목표와 순위 (prizes 는 1~5위 상금) */
export async function raceState(env: Env, round: Round, prizes: number[], now = Date.now()): Promise<RaceEntry[]> {
  // 끝난 판은 끝날 때의 레벨로 (쉬는 주에 오른 레벨로 달성률이 바뀌지 않게)
  const { start, end } = round;
  const at = (col: "level" | "exp") =>
    now >= end
      ? `COALESCE((SELECT l.${col} FROM level_log l WHERE l.user_id = t.user_id AND l.at < ${end} ORDER BY l.at DESC LIMIT 1), p.${col})`
      : `p.${col}`;
  const { results } = await env.DB.prepare(
    `SELECT t.user_id AS id, t.from_level AS fromLevel, t.target AS target, ${at("level")} AS level, ${at("exp")} AS exp, p.job AS job, ` +
      "a.updated_at AS avatar, u.high_spec AS high, " +
      "(SELECT MIN(l.at) FROM level_log l WHERE l.user_id = t.user_id AND l.level >= t.target AND l.at >= ? AND l.at < ?) AS doneAt " +
      "FROM gc_targets t JOIN profiles p ON p.user_id = t.user_id JOIN users u ON u.id = t.user_id " +
      "LEFT JOIN avatars a ON a.user_id = t.user_id WHERE t.round = ?",
  )
    .bind(start, end, round.id)
    .all<{ id: string; fromLevel: number; target: number; level: number; exp: number | null; job: string; avatar: number | null; high: number | null; doneAt: number | null }>();
  const list = results.map((r) => ({
    id: r.id,
    fromLevel: r.fromLevel,
    target: r.target,
    level: r.level,
    exp: r.exp,
    job: r.job,
    avatar: r.avatar,
    highSpec: r.high === 1,
    doneAt: r.doneAt,
    pct: r.doneAt !== null ? 100 : progress(r.fromLevel, r.target, r.level, r.exp),
    rank: 0,
    coins: 0,
  }));
  list.sort((a, b) =>
    a.doneAt !== null || b.doneAt !== null
      ? (a.doneAt ?? Infinity) - (b.doneAt ?? Infinity) || a.id.localeCompare(b.id)
      : b.pct - a.pct || a.id.localeCompare(b.id),
  );
  list.forEach((e, i) => {
    e.rank = i + 1;
    if (e.doneAt !== null) e.coins = prizes[i] ?? 0;
  });
  return list;
}

/**
 * 달성한 1~5위에게 상금을 넣는다 (사람마다 판마다 한 번, gc_ledger 의 (user_id, kind, ref) 유일 색인). 새로 넣은 사람을 돌려준다.
 * 화면을 열 때와 레벨을 저장할 때 부른다. 2군에 열기 전에는 알림을 보내지 않는다
 */
export async function awardRace(env: Env, round: Round, list: RaceEntry[]): Promise<RaceEntry[]> {
  const win = list.filter((e) => e.doneAt !== null && e.coins > 0);
  if (!win.length) return [];
  const res = await env.DB.batch(
    win.map((e) =>
      env.DB.prepare(
        "INSERT OR IGNORE INTO gc_ledger (user_id, delta, kind, ref, note, by_user, created_at) VALUES (?, ?, 'race', ?, ?, NULL, ?)",
      ).bind(e.id, e.coins, `race:${round.id}`, `주간 목표 Lv.${e.target} ${e.rank}위 달성`, e.doneAt),
    ),
  );
  const fresh = win.filter((_, i) => (res[i]?.meta?.changes ?? 0) > 0);
  if (gcoinOpen())
    for (const e of fresh)
      await notify(env, [e.id], "gcoin", `🏁 주간 목표 Lv.${e.target} ${e.rank}위 달성 · 성장코인 +${e.coins}`, "#/gcoin", "system");
  return fresh;
}

/**
 * 추월 차트 (제작자 2026-11-09 '누가 추월하고 이런 거도 차트로, x축은 2주 y축은 달성률'): 사람마다 [때, 달성률] 점들.
 * 판 시작 때 자리(그 전 마지막 기록)에서 시작해 판 안의 기록마다, 달성률은 지금까지의 최고 (오타 수정으로 내려간 점은 그리지 않는다)
 */
async function raceSeries(env: Env, round: Round, list: RaceEntry[]): Promise<Record<string, [number, number][]>> {
  if (!list.length) return {};
  const { start, end } = round;
  const ids = JSON.stringify(list.map((e) => e.id));
  const [before, during] = await Promise.all([
    env.DB.prepare(
      "SELECT l.user_id AS id, l.level AS level, l.exp AS exp FROM level_log l WHERE l.user_id IN (SELECT value FROM json_each(?)) " +
        "AND l.at = (SELECT MAX(at) FROM level_log m WHERE m.user_id = l.user_id AND m.at < ?)",
    )
      .bind(ids, start)
      .all<{ id: string; level: number; exp: number | null }>(),
    env.DB.prepare(
      "SELECT user_id AS id, at, level, exp FROM level_log WHERE user_id IN (SELECT value FROM json_each(?)) AND at >= ? AND at < ? ORDER BY at",
    )
      .bind(ids, start, end)
      .all<{ id: string; at: number; level: number; exp: number | null }>(),
  ]);
  const by = new Map(list.map((e) => [e.id, e]));
  const out: Record<string, [number, number][]> = {};
  const best = new Map<string, number>();
  const add = (id: string, at: number, level: number, exp: number | null) => {
    const e = by.get(id);
    if (!e) return;
    const p = level >= e.target ? 100 : progress(e.fromLevel, e.target, level, exp);
    const b = Math.max(best.get(id) ?? 0, p);
    const pts = (out[id] ??= []);
    if (pts.length && pts[pts.length - 1][1] === b) return;
    best.set(id, b);
    pts.push([at, b]);
  };
  for (const r of before.results) add(r.id, start, r.level, r.exp);
  for (const e of list) if (!out[e.id]) out[e.id] = [[start, 0]];
  for (const r of during.results) add(r.id, r.at, r.level, r.exp);
  return out;
}

/** 화면에 주는 판 자료. 끝났으면 next(다음 판, 안 정했으면 null)와 그 판에 정해 둔 목표(upcoming)도. target = 담당자가 목표·기간을 정하는 판 */
export async function raceData(env: Env, now = Date.now()) {
  const rounds = await readRounds(env);
  const round = await currentRound(env, now, rounds);
  const prizes = await readRank(env);
  const list = await raceState(env, round, prizes, now);
  const [series] = await Promise.all([raceSeries(env, round, list), awardRace(env, round, list)]);
  const nx = await nextRound(env, now, rounds);
  const upcoming = nx
    ? (
        await env.DB.prepare("SELECT user_id AS id, from_level AS fromLevel, target FROM gc_targets WHERE round = ?")
          .bind(nx.id)
          .all<{ id: string; fromLevel: number; target: number }>()
      ).results
    : null;
  return {
    id: round.id,
    start: round.start,
    end: round.end,
    next: nx?.start ?? null,
    nextEnd: nx?.end ?? null,
    nextId: nx?.id ?? null,
    prizes,
    list,
    series,
    upcoming,
  };
}

export interface RaceGain {
  target: number;
  fromLevel: number;
  /** 저장 전·후 달성률 */
  prevPct: number;
  pct: number;
  /** 이번 저장으로 목표를 찍었는지, 그 순위와 상금 */
  justDone: boolean;
  rank: number;
  coins: number;
}

/** 레벨을 저장하기 전 내 목표 (목표가 없거나 2군 본캐가 아니면 null) */
export async function raceBefore(env: Env, me: User) {
  if (!canUseGcoin(me) || !(await isMember(env, me.id))) return null;
  const round = await currentRound(env);
  if (Date.now() < round.start || Date.now() >= round.end) return null;
  const prizes = await readRank(env);
  const mine = (await raceState(env, round, prizes)).find((e) => e.id === me.id);
  return mine ? { round, prizes, mine } : null;
}

/** 저장한 뒤: 달성률이 얼마나 올랐는지, 이번에 목표를 찍었으면 순위와 상금 (화면이 팝업을 띄운다) */
export async function raceAfter(env: Env, me: User, before: { round: Round; prizes: number[]; mine: RaceEntry }): Promise<RaceGain | null> {
  const list = await raceState(env, before.round, before.prizes);
  await awardRace(env, before.round, list);
  const mine = list.find((e) => e.id === me.id);
  if (!mine) return null;
  const justDone = before.mine.doneAt === null && mine.doneAt !== null;
  if (mine.pct === before.mine.pct && !justDone) return null;
  return {
    target: mine.target,
    fromLevel: mine.fromLevel,
    prevPct: before.mine.pct,
    pct: mine.pct,
    justDone,
    rank: mine.rank,
    coins: justDone ? mine.coins : 0,
  };
}

/** 끝난 판의 결과 한 줄 (담당자 > 기록, 제작자 2026-11-10 '이벤트 종료하면 1차 이벤트 결과를 기록으로 남겨') */
export interface RoundResult {
  round: number;
  start: number;
  end: number;
  rank: number;
  userId: string;
  fromLevel: number;
  target: number;
  level: number;
  exp: number | null;
  doneAt: number | null;
  pct: number;
  coins: number;
}

/** id 로 판 찾기 (담당자가 정한 판, 없으면 기본 판) */
function roundOf(id: number, rounds: Round[] | null): Round {
  return rounds?.find((r) => r.id === id) ?? defaultRound(id);
}

/**
 * 끝났는데 아직 결과를 안 남긴 판(목표가 있는 판)을 끝날 때 레벨로 셈해 gc_round_results 에 남긴다. 판마다 한 번 (round, user_id 키).
 * 상금은 실제로 넣은 장부(gc_ledger ref 'race:<id>')로. 계정을 지워도 결과 줄은 남는다 (기록은 평생)
 */
export async function snapshotEnded(env: Env, now = Date.now()): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT round FROM gc_targets WHERE round NOT IN (SELECT round FROM gc_round_results)",
  ).all<{ round: number }>();
  if (!results.length) return;
  const rounds = await readRounds(env);
  const prizes = await readRank(env);
  for (const { round: id } of results) {
    const r = roundOf(id, rounds);
    if (now < r.end) continue;
    const list = await raceState(env, r, prizes, now);
    if (!list.length) continue;
    await awardRace(env, r, list);
    const paid = await env.DB.prepare("SELECT user_id AS id, delta FROM gc_ledger WHERE kind = 'race' AND ref = ?")
      .bind(`race:${r.id}`)
      .all<{ id: string; delta: number }>();
    const coin = new Map(paid.results.map((p) => [p.id, p.delta]));
    await env.DB.batch(
      list.map((e) =>
        env.DB.prepare(
          "INSERT OR IGNORE INTO gc_round_results (round, start, end_at, rank, user_id, from_level, target, level, exp, done_at, pct, coins, saved_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(r.id, r.start, r.end, e.rank, e.id, e.fromLevel, e.target, e.level, e.exp, e.doneAt, e.pct, coin.get(e.id) ?? 0, now),
      ),
    );
  }
}

/** 남긴 결과들 (최근 판부터 20판) */
export async function roundResults(env: Env): Promise<RoundResult[]> {
  const { results } = await env.DB.prepare(
    "SELECT round, start, end_at AS end, rank, user_id AS userId, from_level AS fromLevel, target, level, exp, done_at AS doneAt, pct, coins " +
      "FROM gc_round_results WHERE round IN (SELECT DISTINCT round FROM gc_round_results ORDER BY start DESC LIMIT 20) ORDER BY start DESC, rank",
  ).all<RoundResult>();
  return results;
}
