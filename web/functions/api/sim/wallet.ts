// 시뮬레이터 행운 코인 (server/simcoin.ts)
// GET  /api/sim/wallet -> { coins, earned, spent, quests(오늘 깬 도전), questCoin, feed, total, refill }
// POST /api/sim/wallet { spend } -> 시도에 쓴 코인을 줄인다 (있는 만큼까지) -> { coins }
// POST /api/sim/wallet { quest: 0|1|2 } -> 오늘의 도전을 깼다 (하루 한 번씩 QUEST_COIN) -> { coins, got }
import { FORBIDDEN, NEED_LOGIN, RANK, TEST_IDS, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { DEV_FLOOR, DEV_REFILL, QUEST_COIN, QUEST_KEYS, earn, ensureWallet, kstDate, refillSql, refillable } from "../../../server/simcoin";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!(me.role === "developer" || TEST_IDS.includes(me.id))) return FORBIDDEN();
  await ensureWallet(env, me.id);
  const refill = refillable(me);
  if (refill) await refillSql(env, me.id).run();
  const now = Date.now();
  const [w, today, feed, total] = await env.DB.batch([
    env.DB.prepare("SELECT coins, earned, spent FROM sim_wallet WHERE user_id = ?").bind(me.id),
    env.DB.prepare("SELECT key, n FROM sim_earn WHERE user_id = ? AND day = ?").bind(me.id, kstDate(now)),
    // 전광판: 사흘 안에 1/100 보다 드문 결과 (테스트 계정 빼고)
    env.DB.prepare(`SELECT user_id, game, label, luck, at FROM sim_feed WHERE at > ? AND user_id NOT IN (${TEST_IDS.map(() => "?").join(", ")}) ORDER BY at DESC LIMIT 12`).bind(now - 3 * 86_400_000, ...TEST_IDS),
    // 내 도박왕 점수 (칭호)
    env.DB.prepare("SELECT COALESCE(SUM(best), 0) AS total FROM (SELECT MAX(luck) AS best FROM sim_records WHERE user_id = ? GROUP BY cat)").bind(me.id),
  ]);
  const n = new Map((today.results as { key: string; n: number }[]).map((r) => [r.key, r.n]));
  return json(
    {
      ...(w.results[0] as object),
      quests: QUEST_KEYS.map((k) => (n.get(k) ?? 0) > 0),
      questCoin: QUEST_COIN,
      feed: feed.results,
      total: (total.results[0] as { total: number } | undefined)?.total ?? 0,
      // 앱개발자는 100 아래로 내려가면 1000 을 채운다 (화면도 같은 규칙)
      refill: refill ? { floor: DEV_FLOOR, add: DEV_REFILL } : null,
    },
    200,
    { "cache-control": "no-store" },
  );
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!(me.role === "developer" || TEST_IDS.includes(me.id))) return FORBIDDEN();
  const body = await readJson<{ spend: unknown; quest: unknown }>(request);
  await ensureWallet(env, me.id);
  if (body.quest !== undefined) {
    const i = Number(body.quest);
    if (![0, 1, 2].includes(i)) return json({ error: "도전이 맞지 않아요" }, 400);
    const got = await earn(env, me.id, QUEST_KEYS[i]);
    const w = await env.DB.prepare("SELECT coins FROM sim_wallet WHERE user_id = ?").bind(me.id).first<{ coins: number }>();
    return json({ coins: w?.coins ?? 0, got });
  }
  const n = Math.round(Number(body.spend));
  if (!(n >= 1 && n <= 1_000_000)) return json({ error: "코인 수가 맞지 않아요" }, 400);
  await env.DB.prepare("UPDATE sim_wallet SET spent = spent + MIN(coins, ?2), coins = coins - MIN(coins, ?2), updated_at = ?3 WHERE user_id = ?1")
    .bind(me.id, n, Date.now())
    .run();
  if (refillable(me)) await refillSql(env, me.id).run();
  const r = await env.DB.prepare("SELECT coins FROM sim_wallet WHERE user_id = ?").bind(me.id).first<{ coins: number }>();
  return json({ coins: r?.coins ?? 0 });
};
