// POST /api/gcoin/orders { itemId, qty } -> 구매 신청 (2군 본캐만, 코인이 모자라면 409). 코인은 바로 빠지고(기다리는 중), 반려·취소되면 돌아온다.
//   오피서에게 알림 (열기 전에는 앱개발자에게만). 실제로 주는 것은 게임 안에서 오피서가
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_QTY, readCaps, canUseGcoin, capKey, openCleanup, int, isMember, notifyStaff, readCurve, unitCount, wallets, weekBought, orderLabel } from "../../../../server/gcoin";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseGcoin(me)) return FORBIDDEN();
  await openCleanup(env);
  if (!(await isMember(env, me.id))) return json({ error: "2군 본캐만 성장코인으로 살 수 있어요" }, 403);
  const b = await readJson<{ itemId: unknown; qty: unknown }>(request);
  const itemId = int(b.itemId, 1, Number.MAX_SAFE_INTEGER);
  const qty = int(b.qty ?? 1, 1, MAX_QTY);
  if (itemId === null || qty === null) return json({ error: "물건이나 개수가 맞지 않아요" }, 400);
  const item = await env.DB.prepare("SELECT id, name, unit, price FROM gc_items WHERE id = ? AND active = 1 AND price > 0").bind(itemId).first<{
    id: number;
    name: string;
    unit: string | null;
    price: number;
  }>();
  if (!item) return json({ error: "지금 팔지 않는 물건이에요" }, 404);
  // 한 주 상한 (사나운 멧돼지 인형 30개)
  const key = capKey(item.name);
  const caps = await readCaps(env);
  const cap = caps[key];
  const want = unitCount(item.unit) * qty;
  if (cap !== undefined) {
    const had = (await weekBought(env, me.id, caps))[key] ?? 0;
    const u = unitCount(item.unit);
    if (had + want > cap) return json({ error: `이번주 구매한도 (${Math.ceil(had / u)}/${Math.floor(cap / u)})` }, 409);
  }
  const [w] = await wallets(env, await readCurve(env), me.id);
  const cost = item.price * qty;
  if (!w || w.balance < cost) return json({ error: `성장코인이 모자라요 (가진 코인 ${w?.balance ?? 0}, 필요 ${cost})` }, 409);
  const ins = await env.DB.prepare("INSERT INTO gc_orders (user_id, item_id, name, unit, price, qty, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)")
    .bind(me.id, item.id, item.name, item.unit, item.price, qty, Date.now())
    .run();
  // 두 신청이 동시에 들어와 둘 다 잔액을 통과했으면 나중 것을 지운다 (코인이 0 아래로 내려가지 않게)
  const [after] = await wallets(env, await readCurve(env), me.id);
  const over = cap !== undefined && ((await weekBought(env, me.id, caps))[key] ?? 0) > cap;
  if (!after || after.balance < 0 || over) {
    await env.DB.prepare("DELETE FROM gc_orders WHERE id = ?").bind(Number(ins.meta.last_row_id)).run();
    return json({ error: over ? "이번주 구매한도를 넘었어요" : `성장코인이 모자라요 (가진 코인 ${w.balance}, 필요 ${cost})` }, 409);
  }
  const label = orderLabel(item.name, item.unit, qty);
  await notifyStaff(env, `${me.id}님의 성장코인 구매 신청 · ${label} (${cost}코인)`, me.id);
  return json({ ok: true, balance: w.balance - cost }, 201);
};
