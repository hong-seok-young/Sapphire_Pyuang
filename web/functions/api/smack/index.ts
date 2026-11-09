// 운영진 때리기 (server/smack.ts, 화면 src/pages/Smack.tsx)
// GET  /api/smack -> { targets, mine: { [운영진]: 기록 }, topTargets, topHitters, hitMe }
//   topTargets 가장 많이 맞은 운영진, topHitters 가장 많이 때린 길드원 (데미지 합 순, 10명. 테스트 계정은 빠진다), hitMe 내가 운영진이면 나를 때린 합
// POST /api/smack { items: [{ target, hits, damage, kos, crits, deadly, best }] } -> { ok }
//   화면이 3초마다(와 화면을 떠날 때 sendBeacon) 그동안 때린 만큼을 더한다. 사용 기록에는 남기지 않는다 (_middleware.ts)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { MAX_BATCH_HITS, MAX_COMBO, MAX_HIT_DAMAGE, NOT_TEST, canSmack, smackTargets } from "../../../server/smack";

interface Row {
  hits: number;
  damage: number;
  kos: number;
  crits: number;
  deadly: number;
  best: number;
}
const TOP = 10;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canSmack(me)) return FORBIDDEN();
  const chars = me.chars ?? [me.id];
  const mineQ = `(${chars.map(() => "?").join(", ")})`;
  const [targets, mine, topTargets, topHitters, hitMe] = await Promise.all([
    smackTargets(env, me.owner ?? me.id),
    env.DB.prepare("SELECT target, hits, damage, kos, crits, deadly, best FROM smack_stats WHERE hitter = ?").bind(me.id).all<Row & { target: string }>(),
    env.DB.prepare(
      `SELECT target AS id, SUM(hits) AS hits, SUM(damage) AS damage, SUM(kos) AS kos FROM smack_stats WHERE ${NOT_TEST("hitter")} GROUP BY target ORDER BY damage DESC LIMIT ${TOP}`,
    ).all<{ id: string; hits: number; damage: number; kos: number }>(),
    env.DB.prepare(
      `SELECT hitter AS id, SUM(hits) AS hits, SUM(damage) AS damage, SUM(kos) AS kos, MAX(best) AS best FROM smack_stats WHERE ${NOT_TEST("hitter")} GROUP BY hitter ORDER BY damage DESC LIMIT ${TOP}`,
    ).all<{ id: string; hits: number; damage: number; kos: number; best: number }>(),
    env.DB.prepare(`SELECT SUM(hits) AS hits, SUM(damage) AS damage, SUM(kos) AS kos, COUNT(DISTINCT hitter) AS people FROM smack_stats WHERE target IN ${mineQ}`)
      .bind(...chars)
      .first<{ hits: number | null; damage: number | null; kos: number | null; people: number }>(),
  ]);
  const mineMap: Record<string, Row> = {};
  for (const r of mine.results) mineMap[r.target] = { hits: r.hits, damage: r.damage, kos: r.kos, crits: r.crits, deadly: r.deadly, best: r.best };
  return json({
    targets,
    mine: mineMap,
    topTargets: topTargets.results,
    topHitters: topHitters.results,
    hitMe: hitMe?.hits ? { hits: hitMe.hits, damage: hitMe.damage ?? 0, kos: hitMe.kos ?? 0, people: hitMe.people } : null,
  });
};

const int = (v: unknown, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canSmack(me)) return FORBIDDEN();
  const b = await readJson<{ items: unknown }>(request);
  const raw = Array.isArray(b.items) ? b.items.slice(0, 10) : [];
  const items: (Row & { target: string })[] = [];
  for (const it of raw as Record<string, unknown>[]) {
    const target = typeof it?.target === "string" ? it.target : "";
    const hits = int(it?.hits, MAX_BATCH_HITS);
    if (!target || !hits) continue;
    const damage = int(it.damage, hits * MAX_HIT_DAMAGE);
    const kos = int(it.kos, hits);
    const crits = int(it.crits ?? 0, hits);
    const deadly = int(it.deadly ?? 0, hits);
    const best = int(it.best ?? 0, MAX_COMBO);
    if (damage === null || kos === null || crits === null || deadly === null || best === null || crits + deadly > hits) return json({ error: "기록이 맞지 않아요" }, 400);
    items.push({ target, hits, damage, kos, crits, deadly, best });
  }
  if (!items.length) return json({ ok: true });
  // 때릴 수 있는 운영진만 (자기 자신, 앱개발자, 없는 아이디는 안 받는다)
  const ok = new Set((await smackTargets(env, me.owner ?? me.id)).map((t) => t.id));
  const good = items.filter((it) => ok.has(it.target));
  if (!good.length) return json({ error: "때릴 수 없는 사람이에요" }, 400);
  const now = Date.now();
  await env.DB.batch(
    good.map((it) =>
      env.DB.prepare(
        "INSERT INTO smack_stats (hitter, target, hits, damage, kos, crits, deadly, best, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT (hitter, target) DO UPDATE SET hits = hits + excluded.hits, damage = damage + excluded.damage, kos = kos + excluded.kos, " +
          "crits = crits + excluded.crits, deadly = deadly + excluded.deadly, best = MAX(best, excluded.best), updated_at = excluded.updated_at",
      ).bind(me.id, it.target, it.hits, it.damage, it.kos, it.crits, it.deadly, it.best, now),
    ),
  );
  return json({ ok: true });
};
