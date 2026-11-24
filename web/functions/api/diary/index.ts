// GET /api/diary -> { runs, rates, settles } : 비공개 일지 (server/diary.ts). 보는 사람만, 다른 사람에게는 404. 사용 기록에 남기지 않는다 (_middleware.ts)
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { NOPE, canUseDiary, readRates } from "../../../server/diary";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  const [runs, shots, rates, settles, shares] = await Promise.all([
    env.DB.prepare(
      "SELECT id, author, day, lv_from, exp_from, t_from, lv_to, exp_to, t_to, settle_id, won, rate, created_at FROM diary_runs ORDER BY day DESC, created_at DESC LIMIT 2000",
    ).all(),
    env.DB.prepare("SELECT id, run_id, side FROM diary_shots").all<{ id: number; run_id: number; side: string }>(),
    readRates(env),
    env.DB.prepare("SELECT id, at, by_user, runs, sum, carry_in, pay, carry_out FROM diary_settles ORDER BY id DESC LIMIT 400").all(),
    env.DB.prepare("SELECT settle_id, token FROM diary_shares").all<{ settle_id: number; token: string }>(),
  ]);
  const shareOf = new Map(shares.results.map((x) => [x.settle_id, x.token]));
  const shotOf = new Map<number, { from?: number; to?: number }>();
  for (const s of shots.results) {
    const o = shotOf.get(s.run_id) ?? {};
    if (s.side === "from" || s.side === "to") o[s.side] = s.id;
    shotOf.set(s.run_id, o);
  }
  return json(
    { runs: runs.results.map((r) => ({ ...r, shots: shotOf.get((r as { id: number }).id) ?? {} })), rates, settles: settles.results.map((x) => ({ ...x, share: shareOf.get((x as { id: number }).id) ?? null })) },
    200,
    { "cache-control": "no-store" },
  );
};
