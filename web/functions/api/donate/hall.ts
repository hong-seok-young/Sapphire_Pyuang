// GET /api/donate/hall?period=all|month -> 명예의 전당 (server/donate.ts hallOfFame, 화면 src/pages/Hall.tsx)
//   { period, hall: 사람마다 쌓인 마일리지 순(50명), lines: 그 사람들의 기부(사람마다 최근 30건), total: { earned, gold, count, people } }
// 기부함과 같은 사람이 본다 (열기 전에는 길드마스터·오피서·앱개발자)
import { FORBIDDEN, NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canUseDonate, hallOfFame } from "../../../server/donate";

function monthStart(now = Date.now()): number {
  const d = new Date(now + 9 * 3_600_000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 9 * 3_600_000;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDonate(me)) return FORBIDDEN();
  const period = new URL(request.url).searchParams.get("period") === "month" ? "month" : "all";
  const { rows, lines } = await hallOfFame(env, period === "month" ? monthStart() : 0);
  const top = rows.slice(0, 50);
  const names = new Set(top.flatMap((h) => h.names));
  const per = new Map<string, number>();
  const shown = lines.filter((l) => {
    if (!names.has(l.who)) return false;
    const n = (per.get(l.who) ?? 0) + 1;
    per.set(l.who, n);
    return n <= 30;
  });
  const sum = (f: (h: (typeof rows)[number]) => number) => rows.reduce((a, h) => a + f(h), 0);
  return json({
    period,
    hall: top,
    lines: shown,
    total: { earned: Math.round(sum((h) => h.earned) * 100) / 100, gold: sum((h) => h.gold), count: sum((h) => h.count), people: rows.length },
  });
};
