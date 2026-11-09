// 2군 성장코인샵 (개발중, 제작자 2026-11-09 '골드말고 성장코인이 쌓이게 하자, 그걸로 성장코인샵 만들어서 구매', '대상은 2군 전원',
// '렙업당 성장코인을 주자, 그 가치는 내가 알려준 정보 보고 설정해봐', '성장 123위는 성장코인을 더 주자', '1군전용처럼 2군전용, 개발중, 나한테만').
// 화면 src/pages/GrowthShop.tsx, src/gcoin.ts. API functions/api/gcoin. 게임을 읽지 않고 본인이 적는 레벨(level_log)만 본다.
//
// 코인 1개 = 1,000골드쯤 (제작자가 알려 준 값: 사나운 멧돼지 20개 12만, 자몽주스 6만, 자몽케이크 8만, 망고워터 20개 3만 5천).
// 레벨 하나 오를 때의 코인(DEFAULT_LEVELS)은 처음 공지의 목표(도등 21→27 … 펀취 36→37)를 하나씩 다 채우면 저마다 70~90코인,
// 곧 공지의 완주 보상 '사나운 멧돼지 10개 + 망고워터 10개'(60 + 18 = 78코인)쯤이 되게 맞췄다. 30 아래는 빨라서 적게, 30부터 어려워져 많게.
//
// 버는 코인 = (시작 때 레벨 + 1 ~ 지금까지 오른 가장 높은 레벨) 마다 gc_levels 값 + gc_ledger(주간 순위 보너스, 오피서 조정).
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
  { minLevel: 31, coin: 35 },
  { minLevel: 34, coin: 40 },
  { minLevel: 36, coin: 50 },
  { minLevel: 37, coin: 80 },
  { minLevel: 38, coin: 100 },
  { minLevel: 39, coin: 120 },
  { minLevel: 45, coin: 150 },
];
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

export interface Wallet {
  id: string;
  /** 지금 레벨 (프로필) */
  level: number | null;
  /** 시작 때 레벨 (이 레벨 위로 오른 만큼 코인) */
  base: number | null;
  /** 지금까지 오른 가장 높은 레벨 */
  top: number | null;
  /** 레벨업으로 번 코인 */
  earned: number;
  /** 순위 보너스 */
  bonus: number;
  /** 오피서 조정 */
  adjust: number;
  /** 구매 신청으로 쓴 코인 (기다리는 중 포함) */
  spent: number;
  balance: number;
}

/** 사람들(ids 없으면 2군 본캐 모두)의 지갑 */
export async function wallets(env: Env, curve: Curve[], one?: string): Promise<Wallet[]> {
  const start = await startAt(env);
  const where = one === undefined ? `IN (${MEMBERS_SQL})` : "= ?";
  const bind = one === undefined ? [] : [one];
  const [base, tops, ledger, spent] = await Promise.all([
    pointsAt(env, start, one ?? null),
    env.DB.prepare(
      `SELECT p.user_id AS id, p.level AS level, MAX(p.level, COALESCE((SELECT MAX(l.level) FROM level_log l WHERE l.user_id = p.user_id AND l.at > ?), 0)) AS top ` +
        `FROM profiles p WHERE p.user_id ${where}`,
    )
      .bind(start, ...bind)
      .all<{ id: string; level: number; top: number }>(),
    env.DB.prepare(`SELECT user_id AS id, kind, SUM(delta) AS n FROM gc_ledger WHERE user_id ${where} GROUP BY user_id, kind`)
      .bind(...bind)
      .all<{ id: string; kind: string; n: number }>(),
    env.DB.prepare(`SELECT user_id AS id, SUM(price * qty) AS n FROM gc_orders WHERE status IN ('pending', 'done') AND user_id ${where} GROUP BY user_id`)
      .bind(...bind)
      .all<{ id: string; n: number }>(),
  ]);
  const led = new Map<string, { bonus: number; adjust: number }>();
  for (const r of ledger.results) {
    const w = led.get(r.id) ?? { bonus: 0, adjust: 0 };
    if (r.kind === "rank") w.bonus += r.n;
    else w.adjust += r.n;
    led.set(r.id, w);
  }
  const sp = new Map(spent.results.map((r) => [r.id, r.n]));
  return tops.results.map((r) => {
    const b = base.get(r.id)?.level ?? r.level;
    let earned = 0;
    for (let lv = b + 1; lv <= r.top; lv++) earned += coinFor(lv, curve);
    const l = led.get(r.id) ?? { bonus: 0, adjust: 0 };
    const s = sp.get(r.id) ?? 0;
    return { id: r.id, level: r.level, base: b, top: r.top, earned, bonus: l.bonus, adjust: l.adjust, spent: s, balance: earned + l.bonus + l.adjust - s };
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

/**
 * 성장 점수: 오른 만큼을 레벨마다 그 레벨의 코인 값으로 무게를 준다 (레벨이 높을수록 1레벨이 힘들어서 공평하게, 제작자 '모두가 공평하게').
 * Lv.36 0% -> 36 50% 는 0.5 x (37 에 오르는 코인). 어느 한쪽 경험치를 모르면 레벨만 센다 (growth.ts grown 과 같다)
 */
export function growthScore(from: { level: number; exp: number | null }, to: { level: number; exp: number | null }, curve: Curve[]): number {
  const exact = from.exp !== null && to.exp !== null;
  const a = from.level + (exact ? (from.exp as number) / 100_000 : 0);
  const b = to.level + (exact ? (to.exp as number) / 100_000 : 0);
  if (b <= a) return 0;
  let s = 0;
  for (let l = Math.floor(a); l < b; l++) s += (Math.min(b, l + 1) - Math.max(a, l)) * coinFor(l + 1, curve);
  return Math.round(s * 10) / 10;
}

export interface RankEntry {
  id: string;
  score: number;
  fromLevel: number;
  level: number;
}

/** [from, to) 동안 2군 본캐의 성장 점수 순위 (오른 사람만). to 가 null 이면 지금 프로필까지 */
export async function weekRanking(env: Env, from: number, to: number | null, curve: Curve[]): Promise<RankEntry[]> {
  const [base, end] = await Promise.all([
    pointsAt(env, from, null),
    to === null
      ? env.DB.prepare(`SELECT user_id, level, exp FROM profiles WHERE user_id IN (${MEMBERS_SQL})`).all<Point>()
      : env.DB.prepare(`SELECT user_id, level, exp, MAX(at) AS at FROM level_log WHERE at < ? AND user_id IN (${MEMBERS_SQL}) GROUP BY user_id`)
          .bind(to)
          .all<Point>(),
  ]);
  const out: RankEntry[] = [];
  for (const e of end.results) {
    const b = base.get(e.user_id);
    if (!b) continue;
    const score = growthScore(b, e, curve);
    if (score > 0) out.push({ id: e.user_id, score, fromLevel: b.level, level: e.level });
  }
  return out.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
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
    const top = (await weekRanking(env, Math.max(w, start), w + WEEK, curve)).slice(0, 3);
    if (!top.length) continue;
    await env.DB.batch(
      top.map((e, i) =>
        env.DB.prepare(
          "INSERT OR IGNORE INTO gc_ledger (user_id, delta, kind, ref, note, by_user, created_at) VALUES (?, ?, 'rank', ?, ?, NULL, ?)",
        ).bind(e.id, rank[i], `w${w}`, `주간 2군 성장 ${i + 1}위 (점수 ${e.score})`, now),
      ),
    );
    if (GCOIN_OPEN)
      for (const [i, e] of top.entries())
        await notify(env, [e.id], "gcoin", `이번 주 2군 성장 ${i + 1}위! 성장코인 +${rank[i]}`, "#/gcoin", "system");
  }
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
