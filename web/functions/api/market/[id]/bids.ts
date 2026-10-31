// POST /api/market/:id/bids { amount } -> 경매 입찰 (남의 경매, 끝나기 전, 시작가 이상이고 지금 최고가보다 높게)
// 최고가와 입찰 수는 모두에게, 누가 얼마를 불렀는지는 판 사람에게만 보인다 (GET /api/market)
import { NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { validPrice } from "../../../../server/market";
import { itemName, notify } from "../../../../server/alerts";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  const row = Number.isInteger(id)
    ? await env.DB.prepare("SELECT seller, status, mode, price, ends_at, item, enhance FROM listings WHERE id = ?")
        .bind(id)
        .first<{ seller: string; status: string; mode: string; price: number; ends_at: number | null; item: string; enhance: number }>()
    : null;
  if (!row || row.mode !== "auction") return json({ error: "없는 경매예요" }, 404);
  if (row.seller === me.id) return json({ error: "내 경매예요" }, 400);
  const now = Date.now();
  if (row.status !== "selling" || (row.ends_at !== null && row.ends_at <= now)) return json({ error: "경매가 끝났어요" }, 409);
  const { amount } = await readJson<{ amount: unknown }>(request);
  if (!validPrice(amount)) return json({ error: "입찰가를 골드로 적어 주세요" }, 400);
  if (amount < row.price) return json({ error: "시작가보다 높게 불러 주세요" }, 400);
  const before = await env.DB.prepare("SELECT user_id FROM listing_bids WHERE listing_id = ? ORDER BY amount DESC LIMIT 1")
    .bind(id)
    .first<{ user_id: string }>();
  // 지금 최고가보다 높을 때만 들어간다 (동시에 불러도 낮은 쪽은 안 들어감)
  const res = await env.DB.prepare(
    "INSERT INTO listing_bids (listing_id, user_id, amount, created_at) SELECT ?, ?, ?, ? " +
      "WHERE ? > COALESCE((SELECT MAX(amount) FROM listing_bids WHERE listing_id = ?), 0)",
  )
    .bind(id, me.id, amount, now, amount, id)
    .run();
  const top = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(amount) AS top FROM listing_bids WHERE listing_id = ?")
    .bind(id)
    .first<{ n: number; top: number | null }>();
  if (res.meta.changes === 0) return json({ error: "지금 최고가보다 높게 불러 주세요", highestBid: top?.top ?? null }, 409);
  const gold = `${amount.toLocaleString("ko-KR")}골드`;
  await notify(env, [row.seller], "market_bid", `${me.id}님이 ${itemName(row)} 경매에 ${gold} 입찰`, "#/market", me.id);
  if (before && before.user_id !== me.id) {
    await notify(env, [before.user_id], "market_outbid", `${itemName(row)} 경매에서 더 높은 입찰이 나왔어요 (${gold})`, "#/market", me.id);
  }
  return json({ bidCount: top?.n ?? 1, highestBid: top?.top ?? amount, myBid: amount }, 201);
};
