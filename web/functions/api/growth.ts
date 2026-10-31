// GET /api/growth?period=day|week|month -> 성장 랭킹 (로그인한 길드원 누구나).
// 한국 시간으로 오늘 0시, 이번 주 월요일 0시, 이번 달 1일 0시부터 지금까지 오른 만큼 (레벨 1 = 100%, 경험치 % 그대로 더함).
// 길드원이 레벨, 경험치를 적을 때마다 남긴 기록(level_log)으로 센다: 기간 시작 전 마지막 기록(없으면 기간 안 첫 기록)과 지금을 비교.
// 오른 사람만 많이 오른 순 (같으면 먼저 적은 사람이 위). 경험치 값 자체는 주지 않고 오른 양(growth, % x 1000)만 준다.
import { NEED_LOGIN, currentUser, json } from "../../server/auth";
import type { Env, Guild, Job, Role } from "../../server/auth";

const KST = 9 * 3_600_000;
const DAY = 86_400_000;
const PERIODS = ["day", "week", "month"] as const;
type Period = (typeof PERIODS)[number];

/** 기간이 시작한 때 (ms) */
function periodStart(period: Period, now: number): number {
  const k = new Date(now + KST);
  const today = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST;
  if (period === "day") return today;
  if (period === "week") return today - ((k.getUTCDay() + 6) % 7) * DAY;
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - KST;
}

interface Point {
  user_id: string;
  level: number;
  exp: number | null;
}

const total = (p: { level: number; exp: number | null }) => p.level * 100_000 + (p.exp ?? 0);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const period = new URL(request.url).searchParams.get("period") ?? "week";
  if (!(PERIODS as readonly string[]).includes(period)) return json({ error: "기간은 day, week, month 예요" }, 400);
  const start = periodStart(period as Period, Date.now());
  const [before, during, current] = await env.DB.batch([
    // SQLite: MAX/MIN 과 같이 고른 칸은 그 줄의 값이다
    env.DB.prepare("SELECT user_id, level, exp, MAX(at) AS at FROM level_log WHERE at <= ? GROUP BY user_id").bind(start),
    env.DB.prepare("SELECT user_id, level, exp, MIN(at) AS at FROM level_log WHERE at > ? GROUP BY user_id").bind(start),
    env.DB.prepare(
      "SELECT u.id AS id, u.role AS role, p.job AS job, p.level AS level, p.exp AS exp, p.guild AS guild, a.updated_at AS avatar, " +
        "(SELECT MAX(at) FROM level_log l WHERE l.user_id = p.user_id) AS last_at " +
        "FROM profiles p JOIN users u ON u.id = p.user_id AND u.id NOT IN ('테스트1', '테스트2') LEFT JOIN avatars a ON a.user_id = p.user_id",
    ),
  ]);
  const base = new Map<string, Point>();
  for (const p of during.results as Point[]) base.set(p.user_id, p);
  for (const p of before.results as Point[]) base.set(p.user_id, p); // 기간 전 기록이 있으면 그것부터
  const entries = (current.results as {
    id: string; role: Role; job: Job; level: number; exp: number | null; guild: Guild | null; avatar: number | null; last_at: number | null;
  }[])
    .map((r) => {
      const from = base.get(r.id);
      return {
        id: r.id, role: r.role, job: r.job, level: r.level, guild: r.guild, avatar: r.avatar,
        fromLevel: from?.level ?? r.level, growth: from ? total(r) - total(from) : 0, updatedAt: r.last_at ?? 0,
      };
    })
    .filter((e) => e.growth > 0)
    .sort((a, b) => b.growth - a.growth || a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
  return json({ period, start, entries });
};
