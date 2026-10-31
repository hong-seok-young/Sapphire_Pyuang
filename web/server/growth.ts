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

/** 오른 사람만 많이 오른 순 (같으면 먼저 적은 사람이 위). 테스트 계정은 뺀다 */
export async function growthEntries(env: Env, period: Period, now = Date.now()): Promise<{ start: number; entries: GrowthEntry[] }> {
  const start = periodStart(period, now);
  const [before, during, current] = await env.DB.batch([
    // SQLite: MAX/MIN 과 같이 고른 칸은 그 줄의 값이다
    env.DB.prepare("SELECT user_id, level, exp, MAX(at) AS at FROM level_log WHERE at <= ? GROUP BY user_id").bind(start),
    env.DB.prepare("SELECT user_id, level, exp, MIN(at) AS at FROM level_log WHERE at > ? GROUP BY user_id").bind(start),
    env.DB.prepare(
      "SELECT u.id AS id, u.role AS role, p.job AS job, p.level AS level, p.exp AS exp, p.guild AS guild, a.updated_at AS avatar, u.high_spec AS high_spec, " +
        "(SELECT MAX(at) FROM level_log l WHERE l.user_id = p.user_id) AS last_at " +
        "FROM profiles p JOIN users u ON u.id = p.user_id AND u.id NOT IN ('테스트1', '테스트2') LEFT JOIN avatars a ON a.user_id = p.user_id",
    ),
  ]);
  const base = new Map<string, Point>();
  for (const p of during.results as Point[]) base.set(p.user_id, p);
  for (const p of before.results as Point[]) base.set(p.user_id, p); // 기간 전 기록이 있으면 그것부터
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
