// POST /api/market/:id/bids { amount } -> 경매 입찰 (남의 경매, 끝나기 전, 시작가 이상이고 지금 최고가보다 높게)
// 최고가와 입찰 수는 모두에게, 누가 얼마를 불렀는지는 판 사람에게만 보인다 (GET /api/market)
import { NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { validPrice } from "../../../../server/market";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  const row = Number.isInteger(id)
    ? await env.DB.prepare("SELECT seller, status, mode, price, ends_at FROM listings WHERE id = ?")
        .bind(id)
        .first<{ seller: string; status: string; mode: string; price: number; ends_at: number | null }>()
    : null;
  if (!row || row.mode !== "auction") return json({ error: "없는 경매예요" }, 404);
  if (row.seller === me.id) return json({ error: "내 경매예요" }, 400);
  const now = Date.now();
  if (row.status !== "selling" || (row.ends_at !== null && row.ends_at <= now)) return json({ error: "경매가 끝났어요" }, 409);
  const { amount } = await readJson<{ amount: unknown }>(request);
  if (!validPrice(amount)) return json({ error: "입찰가를 골드로 적어 주세요" }, 400);
  if (amount < row.price) return json({ error: "시작가보다 높게 불러 주세요" }, 400);
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
  return json({ bidCount: top?.n ?? 1, highestBid: top?.top ?? amount, myBid: amount }, 201);
};
