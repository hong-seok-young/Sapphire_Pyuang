// 시뮬레이터 행운 코인 (server/simcoin.ts)
// GET  /api/sim/wallet -> { coins, earned, spent, rules: [{ key, label, coin, cap, n(오늘 받은 횟수) }] }
// POST /api/sim/wallet { spend } -> 시도에 쓴 코인을 줄인다 (있는 만큼까지) -> { coins }
import { FORBIDDEN, NEED_LOGIN, RANK, TEST_IDS, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { EARN, ensureWallet, kstDate } from "../../../server/simcoin";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!(RANK[me.role] >= 1 || TEST_IDS.includes(me.id))) return FORBIDDEN();
  await ensureWallet(env, me.id);
  const [w, today] = await env.DB.batch([
    env.DB.prepare("SELECT coins, earned, spent FROM sim_wallet WHERE user_id = ?").bind(me.id),
    env.DB.prepare("SELECT key, n FROM sim_earn WHERE user_id = ? AND day = ?").bind(me.id, kstDate(Date.now())),
  ]);
  const n = new Map((today.results as { key: string; n: number }[]).map((r) => [r.key, r.n]));
  return json(
    { ...(w.results[0] as object), rules: EARN.map((r) => ({ key: r.key, label: r.label, coin: r.coin, cap: r.cap, n: n.get(r.key) ?? 0 })) },
    200,
    { "cache-control": "no-store" },
  );
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!(RANK[me.role] >= 1 || TEST_IDS.includes(me.id))) return FORBIDDEN();
  const n = Math.round(Number((await readJson<{ spend: unknown }>(request)).spend));
  if (!(n >= 1 && n <= 1_000_000)) return json({ error: "코인 수가 맞지 않아요" }, 400);
  await ensureWallet(env, me.id);
  const r = await env.DB.prepare(
    "UPDATE sim_wallet SET spent = spent + MIN(coins, ?2), coins = coins - MIN(coins, ?2), updated_at = ?3 WHERE user_id = ?1 RETURNING coins",
  )
    .bind(me.id, n, Date.now())
    .first<{ coins: number }>();
  return json({ coins: r?.coins ?? 0 });
};
