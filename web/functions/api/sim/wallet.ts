// 시뮬레이터 행운 코인 (server/simcoin.ts). ?space=test 는 앱개발자 테스트판 (표 sim_t_*), 없으면 개발 중판 (표 sim_*)
// GET  /api/sim/wallet -> { coins, earned, spent, rules, quests, questCoin, feed, total, refill, unlocks, state }
// POST /api/sim/wallet { spend } -> 시도에 쓴 코인을 줄인다 (있는 만큼까지) -> { coins }
// POST /api/sim/wallet { quest: 0|1|2 } -> 오늘의 도전을 깼다 (하루 한 번씩 QUEST_COIN) -> { coins, got }
// POST /api/sim/wallet { unlock: 'auto:장비' | 'buy:장비', cost, spend? } -> 장비마다 자동 강화·자동 구매 해금 (제작자 2026-11-04 '자동 강화도 무기별로 각각 해금, 해금 비용은 코인').
//      값은 화면이 장비 값으로 셈한다 (재미로만, 범위만 본다). 코인이 모자라면 409, 이미 해금했으면 그대로 -> { coins, unlocks }
// POST /api/sim/wallet { state } -> 진행 상황(들고 있는 장비, 보관함, 직접 겪은 것) JSON 을 그대로 둔다 (제작자 2026-11-04 '8강 참나무지팡이가 장비 바꾸기 누르니까 없어졌네':
//      폰에만 두다 덮였다. 이제 서버에, 다른 폰에서도 그대로) -> { ok }
import { FORBIDDEN, NEED_LOGIN, TEST_IDS, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { DEV_FLOOR, DEV_REFILL, EARN, QUEST_COIN, QUEST_KEYS, earn, ensureWallet, kstDate, refillSql, refillable, spaceOf, tbl } from "../../../server/simcoin";

const unlocksOf = async (env: Env, id: string, T: string) =>
  ((await env.DB.prepare(`SELECT key FROM ${T}unlocks WHERE user_id = ?`).bind(id).all<{ key: string }>()).results ?? []).map((r) => r.key);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const space = spaceOf(request, me);
  if (!space) return FORBIDDEN();
  const T = tbl(space);
  await ensureWallet(env, me.id, space);
  const refill = refillable(me);
  if (refill) await refillSql(env, me.id, space).run();
  const now = Date.now();
  const [w, today, feed, total, unlocks, state] = await env.DB.batch([
    env.DB.prepare(`SELECT coins, earned, spent FROM ${T}wallet WHERE user_id = ?`).bind(me.id),
    env.DB.prepare(`SELECT key, n FROM ${T}earn WHERE user_id = ? AND day = ?`).bind(me.id, kstDate(now)),
    // 전광판: 사흘 안에 1/100 보다 드문 결과 (테스트 계정 빼고)
    env.DB.prepare(`SELECT user_id, game, label, luck, at FROM ${T}feed WHERE at > ? AND user_id NOT IN (${TEST_IDS.map(() => "?").join(", ")}) ORDER BY at DESC LIMIT 12`).bind(now - 3 * 86_400_000, ...TEST_IDS),
    // 내 도박의 신 점수 (칭호)
    env.DB.prepare(`SELECT COALESCE(SUM(best), 0) AS total FROM (SELECT MAX(luck) AS best FROM ${T}records WHERE user_id = ? GROUP BY cat)`).bind(me.id),
    env.DB.prepare(`SELECT key FROM ${T}unlocks WHERE user_id = ?`).bind(me.id),
    env.DB.prepare(`SELECT data FROM ${T}state WHERE user_id = ?`).bind(me.id),
  ]);
  const n = new Map((today.results as { key: string; n: number }[]).map((r) => [r.key, r.n]));
  let saved: unknown = null;
  try {
    const raw = (state.results[0] as { data: string } | undefined)?.data;
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  return json(
    {
      ...(w.results[0] as object),
      rules: EARN.map((r) => ({ key: r.key, label: r.label, coin: r.coin, cap: r.cap, n: n.get(r.key) ?? 0 })),
      quests: QUEST_KEYS.map((k) => (n.get(k) ?? 0) > 0),
      questCoin: QUEST_COIN,
      feed: feed.results,
      total: (total.results[0] as { total: number } | undefined)?.total ?? 0,
      // 앱개발자는 100 아래로 내려가면 1000 을 채운다 (화면도 같은 규칙)
      refill: refill ? { floor: DEV_FLOOR, add: DEV_REFILL } : null,
      unlocks: (unlocks.results as { key: string }[]).map((r) => r.key),
      state: saved,
    },
    200,
    { "cache-control": "no-store" },
  );
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const space = spaceOf(request, me);
  if (!space) return FORBIDDEN();
  const T = tbl(space);
  const body = await readJson<{ spend: unknown; quest: unknown; unlock: unknown; cost: unknown; state: unknown }>(request);
  await ensureWallet(env, me.id, space);
  if (body.state !== undefined) {
    const data = JSON.stringify(body.state ?? null);
    if (data.length > 200_000) return json({ error: "진행 상황이 너무 커요" }, 400);
    await env.DB.prepare(`INSERT INTO ${T}state (user_id, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET data = ?2, updated_at = ?3`)
      .bind(me.id, data, Date.now())
      .run();
    if (body.spend === undefined) return json({ ok: true });
  }
  if (body.quest !== undefined) {
    const i = Number(body.quest);
    if (![0, 1, 2].includes(i)) return json({ error: "도전이 맞지 않아요" }, 400);
    const got = await earn(env, me.id, QUEST_KEYS[i], space);
    const w = await env.DB.prepare(`SELECT coins FROM ${T}wallet WHERE user_id = ?`).bind(me.id).first<{ coins: number }>();
    return json({ coins: w?.coins ?? 0, got });
  }
  const n = Math.round(Number(body.spend ?? 0));
  if (body.unlock === undefined && !(n >= 1 && n <= 1_000_000)) return json({ error: "코인 수가 맞지 않아요" }, 400);
  if (n >= 1 && n <= 1_000_000)
    await env.DB.prepare(`UPDATE ${T}wallet SET spent = spent + MIN(coins, ?2), coins = coins - MIN(coins, ?2), updated_at = ?3 WHERE user_id = ?1`)
      .bind(me.id, n, Date.now())
      .run();
  if (body.unlock !== undefined) {
    const key = String(body.unlock);
    const cost = Math.round(Number(body.cost));
    if (!/^(auto|buy):.{1,60}$/.test(key) || !(cost >= 1 && cost <= 100_000)) return json({ error: "해금이 맞지 않아요" }, 400);
    const have = await env.DB.prepare(`SELECT 1 AS one FROM ${T}unlocks WHERE user_id = ? AND key = ?`).bind(me.id, key).first();
    if (!have) {
      const r = await env.DB.prepare(`UPDATE ${T}wallet SET coins = coins - ?2, spent = spent + ?2, updated_at = ?3 WHERE user_id = ?1 AND coins >= ?2`)
        .bind(me.id, cost, Date.now())
        .run();
      if (!r.meta.changes) {
        const w = await env.DB.prepare(`SELECT coins FROM ${T}wallet WHERE user_id = ?`).bind(me.id).first<{ coins: number }>();
        return json({ error: "코인이 모자라요", coins: w?.coins ?? 0, unlocks: await unlocksOf(env, me.id, T) }, 409);
      }
      await env.DB.prepare(`INSERT OR IGNORE INTO ${T}unlocks (user_id, key, cost, at) VALUES (?, ?, ?, ?)`).bind(me.id, key, cost, Date.now()).run();
    }
    if (refillable(me)) await refillSql(env, me.id, space).run();
    const w = await env.DB.prepare(`SELECT coins FROM ${T}wallet WHERE user_id = ?`).bind(me.id).first<{ coins: number }>();
    return json({ coins: w?.coins ?? 0, unlocks: await unlocksOf(env, me.id, T) });
  }
  if (refillable(me)) await refillSql(env, me.id, space).run();
  const r = await env.DB.prepare(`SELECT coins FROM ${T}wallet WHERE user_id = ?`).bind(me.id).first<{ coins: number }>();
  return json({ coins: r?.coins ?? 0 });
};
