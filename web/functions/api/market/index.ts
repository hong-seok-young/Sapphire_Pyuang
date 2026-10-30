// GET  /api/market -> 사파이어 중개인: 판매 중인 글 전부와 내 글(거래 완료 포함).
//      글마다 '살래요' 수와 내가 눌렀는지. 내 글에는 누른 사람 명단(wanters)도 준다 (명단은 판 사람에게만)
// POST /api/market { item, category, enhance, enchant, enchantValue, qty, price, note, options } -> 팔 물건 올리기
//      options: 옵션이 범위에서 뜨는 아이템이면 판 사람이 적은 값 [{ name, value, unit }]
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { KEEP_SOLD_MS, MAX_SELLING, listingOut, readListing } from "../../../server/market";
import type { ListingRow } from "../../../server/market";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const [rows, wanters] = await env.DB.batch([
    env.DB.prepare(
      "SELECT l.*, (SELECT COUNT(*) FROM listing_wants w WHERE w.listing_id = l.id) AS wants, " +
        "EXISTS (SELECT 1 FROM listing_wants w WHERE w.listing_id = l.id AND w.user_id = ?1) AS wanted " +
        "FROM listings l WHERE l.status = 'selling' OR l.seller = ?1 ORDER BY l.created_at DESC",
    ).bind(me.id),
    env.DB.prepare(
      "SELECT w.listing_id AS listing_id, w.user_id AS user_id, w.note AS note, w.created_at AS created_at " +
        "FROM listing_wants w JOIN listings l ON l.id = w.listing_id WHERE l.seller = ? ORDER BY w.created_at",
    ).bind(me.id),
  ]);
  const byListing = new Map<number, { id: string; note: string | null; at: number }[]>();
  for (const w of wanters.results as { listing_id: number; user_id: string; note: string | null; created_at: number }[]) {
    const list = byListing.get(w.listing_id) ?? [];
    list.push({ id: w.user_id, note: w.note, at: w.created_at });
    byListing.set(w.listing_id, list);
  }
  return json({
    listings: (rows.results as (ListingRow & { wants: number; wanted: number })[]).map((r) => ({
      ...listingOut(r),
      wants: r.wants,
      wanted: r.wanted === 1,
      ...(r.seller === me.id ? { wanters: byListing.get(r.id) ?? [] } : {}),
    })),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const input = readListing(await readJson<Record<string, unknown>>(request));
  if (typeof input === "string") return json({ error: input }, 400);
  const now = Date.now();
  // 오래된 거래 완료 글 정리 (올릴 때 가끔 하면 충분하다)
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM listing_wants WHERE listing_id IN (SELECT id FROM listings WHERE status = 'sold' AND updated_at < ?)",
    ).bind(now - KEEP_SOLD_MS),
    env.DB.prepare("DELETE FROM listings WHERE status = 'sold' AND updated_at < ?").bind(now - KEEP_SOLD_MS),
  ]);
  const selling = await env.DB.prepare("SELECT COUNT(*) AS n FROM listings WHERE seller = ? AND status = 'selling'")
    .bind(me.id)
    .first<{ n: number }>();
  if ((selling?.n ?? 0) >= MAX_SELLING) return json({ error: `한 사람이 ${MAX_SELLING}개까지 팔 수 있어요. 다 판 것은 '거래 완료'를 눌러 주세요` }, 409);
  const row = await env.DB.prepare(
    "INSERT INTO listings (seller, item, category, enhance, enchant, enchant_value, qty, price, note, options, status, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'selling', ?, ?) RETURNING *",
  )
    .bind(
      me.id, input.item, input.category, input.enhance, input.enchant, input.enchantValue, input.qty, input.price, input.note,
      input.options ? JSON.stringify(input.options) : null, now, now,
    )
    .first<ListingRow>();
  if (!row) return json({ error: "올리지 못했어요" }, 500);
  return json({ ...listingOut(row), wants: 0, wanted: false, wanters: [] }, 201);
};
