// GET  /api/market -> 사파이어 중개인: 판매 중인 글 전부와 내 글(거래 완료 포함), 골드 시세(goldRate, 현금 환산용).
//      글마다 '살래요' 수와 내가 눌렀는지, 내가 제시한 흥정 가격(myOffer). 경매는 입찰 수, 최고가, 내 최고 입찰.
//      내 글에는 누른 사람 명단(wanters, 흥정 가격 포함)과 입찰 명단(bids)도 준다 (판 사람에게만)
// POST /api/market { item, category, enhance, enchant, enchantValue, qty, price, note, options, mode, hours } -> 팔 물건 올리기
//      options: 옵션이 범위에서 뜨는 아이템이면 판 사람이 적은 값 [{ name, value, unit }]
//      mode: sale 바로 판매 | auction 경매 (price = 시작가, hours 시간 동안)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { MAX_SELLING, SHOW_SOLD_MS, USUAL_GOLD_RATE, listingOut, readListing } from "../../../server/market";
import type { ListingRow } from "../../../server/market";
import { itemName, notify } from "../../../server/alerts";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const [rows, wanters, bids, rate] = await env.DB.batch([
    env.DB.prepare(
      "SELECT l.*, (SELECT COUNT(*) FROM listing_wants w WHERE w.listing_id = l.id) AS wants, " +
        "EXISTS (SELECT 1 FROM listing_wants w WHERE w.listing_id = l.id AND w.user_id = ?1) AS wanted, " +
        "(SELECT offer FROM listing_wants w WHERE w.listing_id = l.id AND w.user_id = ?1) AS my_offer, " +
        "(SELECT COUNT(*) FROM listing_bids b WHERE b.listing_id = l.id) AS bid_count, " +
        "(SELECT MAX(amount) FROM listing_bids b WHERE b.listing_id = l.id) AS highest_bid, " +
        "(SELECT MAX(amount) FROM listing_bids b WHERE b.listing_id = l.id AND b.user_id = ?1) AS my_bid, " +
        "(SELECT COUNT(*) FROM listing_talk t WHERE t.listing_id = l.id) AS talk_count " +
        "FROM listings l WHERE l.status = 'selling' OR (l.seller = ?1 AND l.updated_at >= ?2) ORDER BY l.created_at DESC",
    ).bind(me.id, Date.now() - SHOW_SOLD_MS),
    env.DB.prepare(
      "SELECT w.listing_id AS listing_id, w.user_id AS user_id, w.note AS note, w.offer AS offer, w.created_at AS created_at " +
        "FROM listing_wants w JOIN listings l ON l.id = w.listing_id WHERE l.seller = ? ORDER BY w.created_at",
    ).bind(me.id),
    env.DB.prepare(
      "SELECT b.listing_id AS listing_id, b.user_id AS user_id, b.amount AS amount, b.created_at AS created_at " +
        "FROM listing_bids b JOIN listings l ON l.id = b.listing_id WHERE l.seller = ? ORDER BY b.amount DESC",
    ).bind(me.id),
    // 현금 환산: 올라와 있는 '골드 팝니다' 글의 평균 시세, 없으면 요즘 시세
    env.DB.prepare("SELECT AVG(rate) AS rate FROM gold_offers WHERE status = 'open' AND side = 'sell'"),
  ]);
  const byListing = new Map<number, { id: string; note: string | null; offer: number | null; at: number }[]>();
  for (const w of wanters.results as { listing_id: number; user_id: string; note: string | null; offer: number | null; created_at: number }[]) {
    const list = byListing.get(w.listing_id) ?? [];
    list.push({ id: w.user_id, note: w.note, offer: w.offer, at: w.created_at });
    byListing.set(w.listing_id, list);
  }
  const bidsBy = new Map<number, { id: string; amount: number; at: number }[]>();
  for (const b of bids.results as { listing_id: number; user_id: string; amount: number; created_at: number }[]) {
    const list = bidsBy.get(b.listing_id) ?? [];
    list.push({ id: b.user_id, amount: b.amount, at: b.created_at });
    bidsBy.set(b.listing_id, list);
  }
  const avg = (rate.results[0] as { rate: number | null } | undefined)?.rate;
  return json({
    goldRate: avg ? Math.round(avg * 10) / 10 : USUAL_GOLD_RATE,
    listings: (rows.results as (ListingRow & {
      wants: number; wanted: number; my_offer: number | null; bid_count: number; highest_bid: number | null; my_bid: number | null;
      talk_count: number;
    })[]).map((r) => ({
      ...listingOut(r),
      wants: r.wants,
      talkCount: r.talk_count,
      wanted: r.wanted === 1,
      myOffer: r.my_offer,
      bidCount: r.bid_count,
      highestBid: r.highest_bid,
      myBid: r.my_bid,
      ...(r.seller === me.id ? { wanters: byListing.get(r.id) ?? [], bids: bidsBy.get(r.id) ?? [] } : {}),
    })),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const input = readListing(await readJson<Record<string, unknown>>(request));
  if (typeof input === "string") return json({ error: input }, 400);
  const now = Date.now();
  const selling = await env.DB.prepare("SELECT COUNT(*) AS n FROM listings WHERE seller = ? AND status = 'selling'")
    .bind(me.id)
    .first<{ n: number }>();
  if ((selling?.n ?? 0) >= MAX_SELLING) return json({ error: `한 사람이 ${MAX_SELLING}개까지 팔 수 있어요. 다 판 것은 '거래 완료'를 눌러 주세요` }, 409);
  const row = await env.DB.prepare(
    "INSERT INTO listings (seller, item, category, enhance, enchant, enchant_value, qty, price, note, options, mode, ends_at, auto_auction, " +
      "status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'selling', ?, ?) RETURNING *",
  )
    .bind(
      me.id, input.item, input.category, input.enhance, input.enchant, input.enchantValue, input.qty, input.price, input.note,
      input.options ? JSON.stringify(input.options) : null, input.mode, input.hours ? now + input.hours * 3_600_000 : null, input.autoAuction, now, now,
    )
    .first<ListingRow>();
  if (!row) return json({ error: "올리지 못했어요" }, 500);
  await notify(env, "all", "market_new", `${me.id}님이 ${itemName(row)} 올림${row.mode === "auction" ? " (경매)" : ""}`, "#/market", me.id);
  return json({ ...listingOut(row), wants: 0, wanted: false, myOffer: null, bidCount: 0, highestBid: null, myBid: null, talkCount: 0, wanters: [], bids: [] }, 201);
};
