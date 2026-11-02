// 성장 랭킹 계산 (functions/api/growth.ts 와 챗봇의 길드 앱 자료 server/chatapp.ts 가 같이 쓴다).
// 한국 시간으로 오늘 0시, 이번 주 목요일 오전 10시(server/week.ts), 이번 달 1일 0시부터 지금까지 오른 만큼 (레벨 1 = 100%, 경험치 % 그대로 더함).
// 길드원이 레벨, 경험치를 적을 때마다 남긴 기록(level_log)으로 센다: 기간 시작 전 마지막 기록(없으면 기간 안 첫 기록)과 지금을 비교.
import type { Env, Guild, Job, Role } from "./auth";
import { weekStart } from "./week";

const KST = 9 * 3_600_000;
export const PERIODS = ["day", "week", "month"] as const;
export type Period = (typeof PERIODS)[number];

/** 기간이 시작한 때 (ms) */
export function periodStart(period: Period, now: number): number {
  const k = new Date(now + KST);
  const today = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST;
  if (period === "day") return today;
  if (period === "week") return weekStart(now);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - KST;
}

interface Point {
  user_id: string;
  level: number;
  exp: number | null;
}

const total = (p: { level: number; exp: number | null }) => p.level * 100_000 + (p.exp ?? 0);
/**
 * 오른 만큼. 어느 한쪽 경험치가 비어 있으면(아직 안 적었던 때) 경험치는 모르는 값이라 오른 레벨만 센다
 * (제작자 요청: 레벨만 적었다가 나중에 경험치를 처음 적은 것이 성장으로 잡혔다)
 */
const grown = (now: { level: number; exp: number | null }, from: { level: number; exp: number | null }) =>
  now.exp === null || from.exp === null ? (now.level - from.level) * 100_000 : total(now) - total(from);

export interface GrowthEntry {
  id: string;
  role: Role;
  job: Job;
  level: number;
  guild: Guild | null;
  avatar: number | null;
  fromLevel: number;
  /** 오른 양 (% x 1000, 레벨 1 = 100000) */
  growth: number;
  updatedAt: number;
  highSpec: boolean;
}

/**
 * 진짜 시작점 (제작자 요청 2026-11-02: '34 레벨 80%대에서 한 걸로 잡혔는데, 중간에 0% 로 적은 때가 진짜 시작 지점'):
 * 시작 기록 뒤로 레벨이 바뀌기 전까지 같은 레벨에서 경험치가 더 낮게 적힌 기록이 있으면 그 가장 낮은 기록부터 센다
 * (앞의 높은 값은 잘못 적은 것으로 본다). list 는 기간 안 기록 (오래된 것부터)
 */
export function realStart<T extends { level: number; exp: number | null }>(base: T | undefined, list: T[]): T | undefined {
  let s = base ?? list[0];
  if (!s) return undefined;
  for (const p of list) {
    if (p.level !== s.level) break;
    if (p.exp !== null && s.exp !== null && p.exp < s.exp) s = p;
  }
  return s;
}

/** 기간 시작 전 마지막 기록과 기간 안 기록들 (사람마다, 오래된 것부터) */
export async function periodPoints(env: Env, start: number): Promise<{ base: Map<string, Point>; during: Map<string, Point[]> }> {
  const [before, during] = await env.DB.batch([
    // SQLite: MAX 와 같이 고른 칸은 그 줄의 값이다
    env.DB.prepare("SELECT user_id, level, exp, MAX(at) AS at FROM level_log WHERE at <= ? GROUP BY user_id").bind(start),
    env.DB.prepare("SELECT user_id, level, exp, at FROM level_log WHERE at > ? ORDER BY user_id, at").bind(start),
  ]);
  const base = new Map<string, Point>();
  for (const p of before.results as Point[]) base.set(p.user_id, p);
  const lists = new Map<string, Point[]>();
  for (const p of during.results as Point[]) {
    if (!lists.has(p.user_id)) lists.set(p.user_id, []);
    lists.get(p.user_id)!.push(p);
  }
  return { base, during: lists };
}

/** 기간 시작 때의 레벨·경험치 (사람마다): 시작 전 마지막 기록(없으면 기간 안 첫 기록)에서 진짜 시작점(realStart) */
export async function startPoints(env: Env, start: number): Promise<Map<string, Point>> {
  const { base, during } = await periodPoints(env, start);
  const out = new Map<string, Point>();
  for (const id of new Set([...base.keys(), ...during.keys()])) {
    const s = realStart(base.get(id), during.get(id) ?? []);
    if (s) out.set(id, s);
  }
  return out;
}

/** 오른 사람만 많이 오른 순 (같으면 먼저 적은 사람이 위). 테스트 계정은 뺀다 */
export async function growthEntries(env: Env, period: Period, now = Date.now()): Promise<{ start: number; entries: GrowthEntry[] }> {
  const start = periodStart(period, now);
  const [base, current] = await Promise.all([
    startPoints(env, start),
    env.DB.prepare(
      "SELECT u.id AS id, u.role AS role, p.job AS job, p.level AS level, p.exp AS exp, p.guild AS guild, a.updated_at AS avatar, u.high_spec AS high_spec, " +
        "(SELECT MAX(at) FROM level_log l WHERE l.user_id = p.user_id) AS last_at " +
        "FROM profiles p JOIN users u ON u.id = p.user_id AND u.id NOT IN ('테스트1', '테스트2') LEFT JOIN avatars a ON a.user_id = p.user_id",
    ).all(),
  ]);
  const entries = (current.results as {
    id: string; role: Role; job: Job; level: number; exp: number | null; guild: Guild | null; avatar: number | null; last_at: number | null; high_spec: number;
  }[])
    .map((r) => {
      const from = base.get(r.id);
      return {
        id: r.id, role: r.role, job: r.job, level: r.level, guild: r.guild, avatar: r.avatar,
        fromLevel: from?.level ?? r.level, growth: from ? grown(r, from) : 0, updatedAt: r.last_at ?? 0,
        highSpec: r.high_spec === 1,
      };
    })
    .filter((e) => e.growth > 0)
    .sort((a, b) => b.growth - a.growth || a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
  return { start, entries };
}
