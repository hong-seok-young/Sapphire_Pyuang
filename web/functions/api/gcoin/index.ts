// GET /api/gcoin -> 2군 성장코인샵 (server/gcoin.ts, src/pages/GrowthShop.tsx)
//   { open, manage, member, start, wallet, history, items, curve, rank, week: { start, top }, lastWinners, admin? }
//   member: 내가 2군 본캐인지 (아니면 지갑이 없다). admin(오피서 이상): 기다리는 신청, 2군 본캐 모두의 지갑, 최근 처리한 신청
import { FORBIDDEN, NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { raceData } from "../../../server/gcrace";
import { GCOIN_OPEN, LEVEL_COINS, MILESTONES, canManageGcoin, canUseGcoin, earnedRows, isMember, milestonesBetween, myStreak, streakBonus, readCurve, readRank, settleWeeks, startAt, wallets, weekRanking } from "../../../server/gcoin";
import { weekStart } from "../../../server/week";

interface OrderRow {
  id: number;
  user_id: string;
  item_id: number | null;
  name: string;
  unit: string | null;
  price: number;
  qty: number;
  status: string;
  note: string | null;
  created_at: number;
  done_at: number | null;
  done_by: string | null;
}
const orderOut = (o: OrderRow) => ({
  id: o.id,
  user: o.user_id,
  itemId: o.item_id,
  name: o.name,
  unit: o.unit,
  price: o.price,
  qty: o.qty,
  status: o.status,
  note: o.note,
  at: o.created_at,
  doneAt: o.done_at,
  doneBy: o.done_by,
});

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseGcoin(me)) return FORBIDDEN();
  const manage = canManageGcoin(me.role);
  const curve = await readCurve(env);
  // 끝난 주의 순위 보너스 (아직이면 지금 한 번)
  await settleWeeks(env, curve);
  // 2주 목표 선착순 (시범운영, server/gcrace.ts): 순위·달성률·추월 차트. 달성한 1~5위 상금도 여기서 넣으므로 지갑보다 먼저
  const race = await raceData(env);
  const [start, rank, mine] = await Promise.all([startAt(env), readRank(env), wallets(env, curve, me.id)]);
  // 2군 본캐만 지갑이 있다 (wallets 는 프로필만 보고 세므로 여기서 2군 본캐인지 다시 본다)
  const wallet = (await isMember(env, me.id)) ? (mine[0] ?? null) : null;

  const now = Date.now();
  const ws = Math.max(weekStart(now), start);
  const [items, top, myOrders, myLedger, winners] = await Promise.all([
    env.DB.prepare(`SELECT id, name, unit, price, gold, active FROM gc_items ${manage ? "" : "WHERE active = 1 AND price > 0 "}ORDER BY sort, id`).all<{
      id: number;
      name: string;
      unit: string | null;
      price: number;
      gold: number | null;
      active: number;
    }>(),
    LEVEL_COINS ? weekRanking(env, ws, null, curve) : Promise.resolve([]),
    env.DB.prepare("SELECT * FROM gc_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 60").bind(me.id).all<OrderRow>(),
    env.DB.prepare("SELECT delta, kind, note, created_at AS at FROM gc_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 60").bind(me.id).all(),
    env.DB.prepare(
      "SELECT user_id AS id, delta, note, created_at AS at FROM gc_ledger WHERE kind = 'rank' AND ref = (SELECT ref FROM gc_ledger WHERE kind = 'rank' ORDER BY created_at DESC LIMIT 1) ORDER BY delta DESC",
    ).all(),
  ]);

  // 성장 현황은 길드 랭킹(성장 랭킹)과 같은 모양이라 직업·캐릭터 사진·고스펙을 붙인다 (제작자 2026-11-09 '랭킹 보여 주는 거는 우리 길드 랭킹 디자인을 따오면 될 듯')
  const shown = top.slice(0, 60);
  const faces = new Map<string, { job: string; avatar: number | null; high: number }>();
  if (shown.length) {
    const rows = await env.DB.prepare(
      "SELECT p.user_id AS id, p.job AS job, a.updated_at AS avatar, u.high_spec AS high FROM profiles p JOIN users u ON u.id = p.user_id " +
        "LEFT JOIN avatars a ON a.user_id = p.user_id WHERE p.user_id IN (SELECT value FROM json_each(?))",
    )
      .bind(JSON.stringify(shown.map((e) => e.id)))
      .all<{ id: string; job: string; avatar: number | null; high: number | null }>();
    for (const r of rows.results) faces.set(r.id, { job: r.job, avatar: r.avatar, high: r.high ?? 0 });
  }
  const weekTop = shown.map((e) => {
    const f = faces.get(e.id);
    return { ...e, job: f?.job ?? "warrior", avatar: f?.avatar ?? null, highSpec: f?.high === 1 };
  });

  let admin: unknown;
  if (manage) {
    const [pending, recent, members] = await Promise.all([
      env.DB.prepare("SELECT * FROM gc_orders WHERE status = 'pending' ORDER BY created_at ASC").all<OrderRow>(),
      env.DB.prepare("SELECT * FROM gc_orders WHERE status != 'pending' ORDER BY COALESCE(done_at, created_at) DESC LIMIT 60").all<OrderRow>(),
      wallets(env, curve),
    ]);
    admin = {
      pending: pending.results.map(orderOut),
      recent: recent.results.map(orderOut),
      members: members.sort((a, b) => b.balance - a.balance || (b.level ?? 0) - (a.level ?? 0) || a.id.localeCompare(b.id)),
    };
  }

  // 번 코인 내역: 레벨마다 한 줄 (덜 채운 레벨은 그 % 까지)
  const levels =
    LEVEL_COINS && wallet && wallet.base !== null && wallet.top !== null
      ? earnedRows(wallet.base + (wallet.baseExp ?? 0) / 100_000, wallet.top + (wallet.topExp ?? 0) / 100_000, curve).filter((r) => r.coin > 0)
      : [];

  // 처음 넘은 레벨 보너스, 다음 첫 달성 보너스, 연속 성장 (재미 요소, 제작자 2026-11-09 '다 만들어봐')
  const milestones = LEVEL_COINS && wallet && wallet.base !== null && wallet.top !== null ? milestonesBetween(wallet.base, wallet.top) : [];
  const nextMilestone = LEVEL_COINS && wallet && wallet.top !== null ? (MILESTONES.find((m) => m.level > (wallet.top as number)) ?? null) : null;
  const streak = LEVEL_COINS && wallet ? await myStreak(env, me.id, now) : 0;

  return json({
    open: GCOIN_OPEN,
    levelCoins: LEVEL_COINS,
    race,
    manage,
    member: !!wallet,
    start,
    wallet,
    history: { levels, milestones, ledger: myLedger.results, orders: myOrders.results.map(orderOut) },
    nextMilestone,
    streak: { count: streak, next: streakBonus(streak + 1) },
    items: items.results.map((i) => ({ id: i.id, name: i.name, unit: i.unit, price: i.price, gold: i.gold ?? i.price * 1000, active: i.active === 1 })),
    curve,
    rank,
    week: { start: ws, top: weekTop },
    lastWinners: winners.results,
    admin,
  });
};
