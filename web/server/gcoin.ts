// 2군 성장코인샵 (개발중, 제작자 2026-11-09 '골드말고 성장코인이 쌓이게 하자, 그걸로 성장코인샵 만들어서 구매', '대상은 2군 전원',
// '렙업당 성장코인을 주자, 그 가치는 내가 알려준 정보 보고 설정해봐', '성장 123위는 성장코인을 더 주자', '1군전용처럼 2군전용, 개발중, 나한테만').
// 화면 src/pages/GrowthShop.tsx, src/gcoin.ts. API functions/api/gcoin. 게임을 읽지 않고 본인이 적는 레벨(level_log)만 본다.
//
// 코인 1개 = 1,000골드쯤 (제작자가 알려 준 값: 사나운 멧돼지 20개 12만, 자몽주스 6만, 자몽케이크 8만, 망고워터 20개 3만 5천).
// 레벨 하나 오를 때의 코인(DEFAULT_LEVELS)은 처음 공지의 목표(도등 21→27 … 펀취 36→37)를 하나씩 다 채우면 저마다 70~90코인,
// 곧 공지의 완주 보상 '사나운 멧돼지 10개 + 망고워터 10개'(60 + 18 = 78코인)쯤이 되게 맞췄다 (30 → 32 = 39 x 2 = 78, 제작자 '30에서 32 찍으면 사멧10 망고워터10 살 코인 수준'). 30 아래는 빨라서 적게, 30부터 어려워져 많게.
//
// 버는 코인 = 시작 때 위치(레벨 + 경험치 %)부터 그 뒤 적은 가장 높은 위치까지 레벨마다 gc_levels 값(경험치 % 는 그만큼 나눠서) + gc_ledger(주간 순위 보너스, 오피서 조정).
// 곧 길드 랭킹·내 정보에 레벨이나 경험치를 적는 순간 코인이 쌓인다 (제작자 '그냥 길드원 랭킹에서 레벨하고 겸치 입력하면 성장코인 주게').
// 쓰는 코인 = 기다리는 중·지급한 구매 신청 (gc_orders). 레벨업 코인은 표에 쌓지 않고 그때그때 센다:
// 오타 수정은 level_log 마지막 줄을 고치므로 잘못 적은 레벨의 코인은 저절로 빠진다.
import type { Env, User } from "./auth";
import { TEST_IDS } from "./auth";
import { notify } from "./alerts";
import { realStart } from "./growth";
import { WEEK, weekStart } from "./week";

/** 2군에게 열기 전에는 앱개발자(와 테스트 계정)만. 화면 launcher.ts 의 GCOIN_OPEN·canGcoin 과 같이 바꾼다 */
export const GCOIN_OPEN = false;
export const canUseGcoin = (me: User) => GCOIN_OPEN || me.role === "developer" || TEST_IDS.includes(me.id);
/** 신청 처리, 설정, 코인 조정: 오피서 이상 */
export const canManageGcoin = (role: User["role"]) => role === "developer" || role === "master" || role === "officer";

/** 레벨 하나 오를 때의 코인 기본값 (min 레벨 이상이면 그 값). 20 아래는 신경 쓰지 않는다 (제작자) */
export const DEFAULT_LEVELS: { minLevel: number; coin: number }[] = [
  { minLevel: 1, coin: 0 },
  { minLevel: 21, coin: 10 },
  { minLevel: 26, coin: 15 },
  { minLevel: 31, coin: 39 },
  { minLevel: 34, coin: 40 },
  { minLevel: 36, coin: 50 },
  { minLevel: 37, coin: 80 },
  { minLevel: 38, coin: 100 },
  { minLevel: 39, coin: 120 },
  { minLevel: 45, coin: 150 },
];
/**
 * 처음 넘는 레벨 보너스 (코인을 세기 시작한 뒤 처음 넘을 때 한 번. 표에 적지 않고 지갑을 셀 때 같이 센다: 오타 수정으로 레벨이 내려가면 같이 빠진다).
 * 제작자 '30부터 어려워짐', '38 + 38제 무기 +8강이면 1군 편입 고려', 만렙 55
 */
export const MILESTONES: { level: number; coin: number; name: string }[] = [
  { level: 30, coin: 50, name: "Lv.30 돌파" },
  { level: 38, coin: 100, name: "Lv.38 · 1군 편입 고려" },
  { level: 45, coin: 150, name: "Lv.45 돌파" },
  { level: 55, coin: 300, name: "만렙 55" },
];
/** 주마다 코인을 번(레벨·경험치를 올린) 주가 이어지면 연속 보너스: 2주째 20, 3주째 30 … 5주째부터 50 */
export const STREAK_COIN = 10;
export const STREAK_MAX = 5;
export const streakBonus = (count: number) => (count >= 2 ? STREAK_COIN * Math.min(count, STREAK_MAX) : 0);
/** base 레벨보다 높고 top 레벨까지 넘은 첫 달성 보너스 */
export const milestonesBetween = (base: number, top: number) => MILESTONES.filter((m) => base < m.level && top >= m.level);

/** 주간 2군 성장 1·2·3위 보너스 기본값 */
export const DEFAULT_RANK = [100, 60, 30];
/** 처음 물건 (코인 1개 = 1,000골드쯤) */
export const DEFAULT_ITEMS: { name: string; unit: string; price: number }[] = [
  { name: "사나운 멧돼지", unit: "10개", price: 60 },
  { name: "사나운 멧돼지", unit: "20개", price: 120 },
  { name: "망고워터", unit: "10개", price: 18 },
  { name: "망고워터", unit: "20개", price: 35 },
  { name: "자몽주스", unit: "1개", price: 60 },
  { name: "자몽케이크", unit: "1개", price: 80 },
];
export const MAX_NAME = 20;
export const MAX_UNIT = 10;
export const MAX_NOTE = 60;
export const MAX_QTY = 20;
export const MAX_PRICE = 100_000;
/** 지난주 보너스를 한 번에 몇 주까지 몰아서 정산하나 (CPU 한도) */
const SETTLE_WEEKS = 4;

export interface Curve {
  minLevel: number;
  coin: number;
}

/** 레벨 L 에 올라서는 데 주는 코인 */
export function coinFor(level: number, curve: Curve[]): number {
  let c = 0;
  for (const r of curve) if (level >= r.minLevel) c = r.coin;
  return c;
}

export async function readCurve(env: Env): Promise<Curve[]> {
  const { results } = await env.DB.prepare("SELECT min_level AS minLevel, coin FROM gc_levels ORDER BY min_level").all<Curve>();
  return results.length ? results : DEFAULT_LEVELS;
}

export async function readRank(env: Env): Promise<number[]> {
  const { results } = await env.DB.prepare("SELECT key, value FROM gc_settings WHERE key IN ('rank1', 'rank2', 'rank3')").all<{ key: string; value: number }>();
  const m = new Map(results.map((r) => [r.key, r.value]));
  return [1, 2, 3].map((i) => m.get(`rank${i}`) ?? DEFAULT_RANK[i - 1]);
}

/** 코인을 세기 시작한 때. 없으면 지금으로 적는다 (배포가 처음 한 번 적는다, scripts/ci-d1.mjs) */
export async function startAt(env: Env): Promise<number> {
  const r = await env.DB.prepare("SELECT done_at FROM setup WHERE key = 'gcoin_start'").first<{ done_at: number }>();
  if (r) return r.done_at;
  const now = Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO setup (key, done_at) VALUES ('gcoin_start', ?)").bind(now).run();
  return now;
}

/** 대상: 2군 본캐 (부캐 빼고, 테스트 계정 빼고). 제작자 '2군 전원', 공지 '본캐이신 분들만' */
const MEMBERS_SQL =
  "SELECT p.user_id FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.guild = 'second' AND u.main_id IS NULL AND u.id NOT IN ('테스트1', '테스트2')";

interface Point {
  user_id: string;
  level: number;
  exp: number | null;
}

/** 어떤 때의 레벨·경험치 (사람마다): 그 전 마지막 기록, 없으면 그 뒤 첫 기록에서 진짜 시작점 (growth.ts 와 같다) */
async function pointsAt(env: Env, at: number, ids: string | null): Promise<Map<string, Point>> {
  const where = ids === null ? `user_id IN (${MEMBERS_SQL})` : "user_id = ?";
  const bind = ids === null ? [] : [ids];
  const [before, after] = await env.DB.batch([
    env.DB.prepare(`SELECT user_id, level, exp, MAX(at) AS at FROM level_log WHERE at <= ? AND ${where} GROUP BY user_id`).bind(at, ...bind),
    env.DB.prepare(`SELECT user_id, level, exp, at FROM level_log WHERE at > ? AND ${where} ORDER BY user_id, at`).bind(at, ...bind),
  ]);
  const base = new Map<string, Point>();
  for (const p of before.results as Point[]) base.set(p.user_id, p);
  const lists = new Map<string, Point[]>();
  for (const p of after.results as Point[]) {
    if (!lists.has(p.user_id)) lists.set(p.user_id, []);
    lists.get(p.user_id)!.push(p);
  }
  const out = new Map<string, Point>();
  for (const id of new Set([...base.keys(), ...lists.keys()])) {
    const s = realStart(base.get(id), lists.get(id) ?? []);
    if (s) out.set(id, s);
  }
  return out;
}

/** 레벨·경험치를 한 줄 위치로 (Lv.36 50% -> 36.5). 경험치를 안 적었으면 0% */
export const posOf = (p: { level: number; exp: number | null }) => p.level + (p.exp ?? 0) / 100_000;

/** a 위치에서 b 위치까지 오른 만큼의 코인 (레벨마다 그 레벨에 오르는 코인 값, 경험치 % 는 그만큼 나눠서). 소수 그대로 */
export function coinsBetween(a: number, b: number, curve: Curve[]): number {
  let s = 0;
  for (let l = Math.floor(a); l < b; l++) s += Math.max(0, Math.min(b, l + 1) - Math.max(a, l)) * coinFor(l + 1, curve);
  // 소수 오차를 지운다 (30.2 - 30 = 0.19999… 라 7코인이 6.999… 로 내려가 1코인이 빠졌다)
  return Math.round(s * 1e6) / 1e6;
}

/**
 * 번 코인 내역 (레벨마다 한 줄, 올라선 레벨은 '달성', 지금 채우는 레벨은 그 % 까지). 줄마다 정수로 나눠 합이 earned 와 같게
 * (누적값의 내림 차이). 최근 것부터
 */
export function earnedRows(a: number, b: number, curve: Curve[]): { level: number; coin: number; pct: number | null }[] {
  const rows: { level: number; coin: number; pct: number | null }[] = [];
  let cum = 0;
  for (let l = Math.floor(a); l < b; l++) {
    const lo = Math.max(a, l);
    const hi = Math.min(b, l + 1);
    if (hi <= lo) continue;
    const before = Math.floor(cum);
    cum = Math.round((cum + (hi - lo) * coinFor(l + 1, curve)) * 1e6) / 1e6;
    // 그 레벨을 끝까지 채웠으면(중간부터 시작했어도) 'Lv.N 달성', 아직 채우는 중이면 그 % 까지
    const up = hi === l + 1;
    rows.push({ level: up ? l + 1 : l, coin: Math.floor(cum) - before, pct: up ? null : Math.round((hi - l) * 1000) / 10 });
  }
  return rows.reverse();
}

export interface Wallet {
  id: string;
  /** 지금 레벨 (프로필) */
  level: number | null;
  /** 시작 때 레벨·경험치 (이 위로 오른 만큼 코인) */
  base: number | null;
  baseExp: number | null;
  /** 지금까지 오른 가장 높은 레벨·경험치 */
  top: number | null;
  topExp: number | null;
  /** 레벨업·경험치로 번 코인 (내림 정수) */
  earned: number;
  /** 처음 넘은 레벨 보너스 (MILESTONES) */
  milestone: number;
  /** 순위·연속 성장 보너스 */
  bonus: number;
  /** 오피서 조정 */
  adjust: number;
  /** 구매 신청으로 쓴 코인 (기다리는 중 포함) */
  spent: number;
  balance: number;
}

/**
 * 사람들(one 이 없으면 2군 본캐 모두)의 지갑. 길드 랭킹·내 정보에 레벨·경험치를 적으면 그만큼 바로 코인 (제작자 '그냥 길드원 랭킹에서 레벨하고 겸치 입력하면 성장코인 주게').
 * 시작 때 위치(진짜 시작점)에서 그 뒤 적은 가장 높은 위치까지
 */
export async function wallets(env: Env, curve: Curve[], one?: string): Promise<Wallet[]> {
  const start = await startAt(env);
  const where = one === undefined ? `IN (${MEMBERS_SQL})` : "= ?";
  const bind = one === undefined ? [] : [one];
  const [base, now, logs, ledger, spent] = await Promise.all([
    pointsAt(env, start, one ?? null),
    env.DB.prepare(`SELECT user_id AS id, level, exp FROM profiles WHERE user_id ${where}`)
      .bind(...bind)
      .all<{ id: string; level: number; exp: number | null }>(),
    env.DB.prepare(`SELECT user_id AS id, level, exp FROM level_log WHERE at > ? AND user_id ${where}`)
      .bind(start, ...bind)
      .all<{ id: string; level: number; exp: number | null }>(),
    env.DB.prepare(`SELECT user_id AS id, kind, SUM(delta) AS n FROM gc_ledger WHERE user_id ${where} GROUP BY user_id, kind`)
      .bind(...bind)
      .all<{ id: string; kind: string; n: number }>(),
    env.DB.prepare(`SELECT user_id AS id, SUM(price * qty) AS n FROM gc_orders WHERE status IN ('pending', 'done') AND user_id ${where} GROUP BY user_id`)
      .bind(...bind)
      .all<{ id: string; n: number }>(),
  ]);
  const top = new Map<string, { level: number; exp: number | null }>();
  for (const r of [...now.results, ...logs.results]) {
    const t = top.get(r.id);
    if (!t || posOf(r) > posOf(t)) top.set(r.id, { level: r.level, exp: r.exp });
  }
  const led = new Map<string, { bonus: number; adjust: number }>();
  for (const r of ledger.results) {
    const w = led.get(r.id) ?? { bonus: 0, adjust: 0 };
    if (r.kind === "adjust") w.adjust += r.n;
    else w.bonus += r.n;
    led.set(r.id, w);
  }
  const sp = new Map(spent.results.map((r) => [r.id, r.n]));
  return now.results.map((r) => {
    const b = base.get(r.id) ?? r;
    const t = top.get(r.id) ?? r;
    const earned = Math.floor(coinsBetween(posOf(b), posOf(t), curve));
    const milestone = milestonesBetween(b.level, t.level).reduce((n, m) => n + m.coin, 0);
    const l = led.get(r.id) ?? { bonus: 0, adjust: 0 };
    const s = sp.get(r.id) ?? 0;
    return {
      id: r.id, level: r.level, base: b.level, baseExp: b.exp, top: t.level, topExp: t.exp,
      earned, milestone, bonus: l.bonus, adjust: l.adjust, spent: s, balance: earned + milestone + l.bonus + l.adjust - s,
    };
  });
}

/** 코인을 쌓고 쓰는 사람인지: 2군 본캐 (테스트 계정도: 앱개발자가 2군 쪽 화면을 시험하려고. 순위·현황에서는 빠진다) */
export async function isMember(env: Env, id: string): Promise<boolean> {
  return !!(await env.DB.prepare(
    "SELECT 1 AS x FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ? AND p.guild = 'second' AND u.main_id IS NULL",
  )
    .bind(id)
    .first());
}

export interface RankEntry {
  id: string;
  /** 그 주에 레벨·경험치로 번 성장코인 (지갑과 같은 셈) */
  coins: number;
  fromLevel: number;
  level: number;
}

/**
 * [from, to) 동안 2군 본캐가 레벨·경험치로 번 성장코인 순위 (번 사람만, 많이 번 순). to 가 null 이면 지금까지.
 * 제작자 2026-11-09 '레벨별 난이도로 순위 매기지 마, 코인 많이 번 순위로': 지갑과 똑같이 주 시작 때 위치부터 그 주에 적은 가장 높은 위치까지
 */
export async function weekRanking(env: Env, from: number, to: number | null, curve: Curve[]): Promise<RankEntry[]> {
  const until = to ?? Number.MAX_SAFE_INTEGER;
  const [base, logs, now] = await Promise.all([
    pointsAt(env, from, null),
    env.DB.prepare(`SELECT user_id, level, exp FROM level_log WHERE at > ? AND at < ? AND user_id IN (${MEMBERS_SQL})`).bind(from, until).all<Point>(),
    to === null
      ? env.DB.prepare(`SELECT user_id, level, exp FROM profiles WHERE user_id IN (${MEMBERS_SQL})`).all<Point>()
      : Promise.resolve({ results: [] as Point[] }),
  ]);
  const top = new Map<string, Point>();
  for (const r of [...logs.results, ...now.results]) {
    const t = top.get(r.user_id);
    if (!t || posOf(r) > posOf(t)) top.set(r.user_id, r);
  }
  const out: RankEntry[] = [];
  for (const [id, t] of top) {
    const b = base.get(id);
    if (!b) continue;
    const coins = Math.floor(coinsBetween(posOf(b), posOf(t), curve));
    if (coins > 0) out.push({ id, coins, fromLevel: b.level, level: t.level });
  }
  return out.sort((x, y) => y.coins - x.coins || x.id.localeCompare(y.id));
}

/**
 * 끝난 주의 순위 보너스를 아직 안 줬으면 준다 (누가 상점을 열 때 한 번, setup 'gcoin_rank_<주 시작>' 을 먼저 적은 곳만).
 * 첫 주는 코인을 세기 시작한 때부터. 2군에 열기 전에는 알림을 보내지 않는다 (나만 보이는 동안 길드원에게 안 알린다)
 */
export async function settleWeeks(env: Env, curve: Curve[], now = Date.now()): Promise<void> {
  const start = await startAt(env);
  const rank = await readRank(env);
  const thisWeek = weekStart(now);
  const weeks: number[] = [];
  for (let w = thisWeek - WEEK; w + WEEK > start && weeks.length < SETTLE_WEEKS; w -= WEEK) weeks.push(w);
  for (const w of weeks.reverse()) {
    const key = `gcoin_rank_${w}`;
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO setup (key, done_at) VALUES (?, ?)").bind(key, now).run();
    if (!claim.meta.changes) continue;
    const all = await weekRanking(env, Math.max(w, start), w + WEEK, curve);
    if (!all.length) continue;
    const top = all.slice(0, 3);
    // 연속 성장: 지난주에도 벌었으면 이어서, 아니면 1주째부터 (gc_streak 은 사람마다 마지막으로 번 주와 이어진 주 수)
    const ids = all.map((e) => e.id);
    const prev = await env.DB.prepare(`SELECT user_id, week, count FROM gc_streak WHERE user_id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all<{ user_id: string; week: number; count: number }>();
    const pm = new Map(prev.results.map((r) => [r.user_id, r]));
    const streaks = all.map((e) => {
      const p = pm.get(e.id);
      return { id: e.id, count: p && p.week === w ? p.count : p && p.week === w - WEEK ? p.count + 1 : 1 };
    });
    await env.DB.batch([
      ...top.map((e, i) =>
        env.DB.prepare(
          "INSERT OR IGNORE INTO gc_ledger (user_id, delta, kind, ref, note, by_user, created_at) VALUES (?, ?, 'rank', ?, ?, NULL, ?)",
        ).bind(e.id, rank[i], `w${w}`, `주간 2군 성장 ${i + 1}위 (그 주 +${e.coins}코인)`, now),
      ),
      ...streaks.map((t) =>
        env.DB.prepare(
          "INSERT INTO gc_streak (user_id, week, count) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET week = excluded.week, count = excluded.count",
        ).bind(t.id, w, t.count),
      ),
      ...streaks
        .filter((t) => streakBonus(t.count) > 0)
        .map((t) =>
          env.DB.prepare(
            "INSERT OR IGNORE INTO gc_ledger (user_id, delta, kind, ref, note, by_user, created_at) VALUES (?, ?, 'streak', ?, ?, NULL, ?)",
          ).bind(t.id, streakBonus(t.count), `w${w}`, `${t.count}주 연속 성장`, now),
        ),
    ]);
    if (GCOIN_OPEN)
      for (const [i, e] of top.entries())
        await notify(env, [e.id], "gcoin", `이번 주 2군 성장 ${i + 1}위! 성장코인 +${rank[i]}`, "#/gcoin", "system");
  }
}

/** 내 연속 성장: 지난주까지 이어진 주 수 (지난주에 못 벌었으면 0) */
export async function myStreak(env: Env, id: string, now = Date.now()): Promise<number> {
  const r = await env.DB.prepare("SELECT week, count FROM gc_streak WHERE user_id = ?").bind(id).first<{ week: number; count: number }>();
  return r && r.week >= weekStart(now) - WEEK ? r.count : 0;
}

/** 운영(오피서 이상)에게 알림. 열기 전에는 앱개발자에게만 */
export async function notifyStaff(env: Env, msg: string, from: string): Promise<void> {
  const where = GCOIN_OPEN ? "role IN ('officer', 'master', 'developer')" : "role = 'developer'";
  const { results } = await env.DB.prepare(`SELECT DISTINCT COALESCE(main_id, id) AS id FROM users WHERE ${where}`).all<{ id: string }>();
  await notify(env, results.map((r) => r.id), "gcoin", msg, "#/gcoin?t=orders", from);
}

/** 글자 칸: 비우면 null, 길면 undefined */
export function text(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return null;
  return t.length <= max ? t : undefined;
}

export const int = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export interface CoinGain {
  /** 이번에 저장해서 새로 생긴 코인 */
  gained: number;
  balance: number;
  /** 저장 전·후 가장 높은 위치 (레벨 + 경험치 %) */
  from: number;
  to: number;
  /** 이번 주 2군 성장 순위 (이번 주 번 코인 순, 번 게 없으면 null) */
  rank: number | null;
  /** 이번 주 번 코인, 바로 위 사람까지 코인 차이 */
  week: number;
  gap: number | null;
  /** 저장하기 전 이번 주 순위 (1위로 올라선 순간을 크게 축하하려고) */
  prevRank: number | null;
  /** 이번에 처음 넘은 레벨 보너스 */
  milestones: { level: number; coin: number; name: string }[];
}

/** 레벨·경험치를 저장하기 전 내 지갑 (2군 본캐가 아니거나 상점을 못 쓰면 null: 그때는 저장 뒤에도 아무것도 안 한다) */
export async function walletBefore(env: Env, me: User): Promise<{ curve: Curve[]; w: Wallet; rank: number | null } | null> {
  if (!canUseGcoin(me) || !(await isMember(env, me.id))) return null;
  const curve = await readCurve(env);
  const [w] = await wallets(env, curve, me.id);
  if (!w) return null;
  const top = await weekRanking(env, Math.max(weekStart(), await startAt(env)), null, curve);
  const i = top.findIndex((e) => e.id === me.id);
  return { curve, w, rank: i >= 0 ? i + 1 : null };
}

/** 저장한 뒤 새로 생긴 코인과 이번 주 순위 (화면이 동전 팝업을 띄운다) */
export async function coinGain(env: Env, me: User, before: { curve: Curve[]; w: Wallet; rank: number | null }): Promise<CoinGain | null> {
  const [w] = await wallets(env, before.curve, me.id);
  if (!w) return null;
  const gained = w.earned + w.milestone - before.w.earned - before.w.milestone;
  if (gained <= 0) return null;
  const start = await startAt(env);
  const top = await weekRanking(env, Math.max(weekStart(), start), null, before.curve);
  const i = top.findIndex((e) => e.id === me.id);
  const pos = (x: Wallet) => (x.top ?? 0) + (x.topExp ?? 0) / 100_000;
  return {
    gained,
    balance: w.balance,
    from: pos(before.w),
    to: pos(w),
    rank: i >= 0 ? i + 1 : null,
    week: i >= 0 ? top[i].coins : 0,
    gap: i > 0 ? top[i - 1].coins - top[i].coins : null,
    prevRank: before.rank,
    milestones: milestonesBetween(Math.max(before.w.top ?? 0, before.w.base ?? 0), w.top ?? 0),
  };
}
