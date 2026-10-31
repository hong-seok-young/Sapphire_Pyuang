// PATCH  /api/market/:id { status?, price?, note? } -> 내 글 고치기: 거래 완료(sold), 다시 판매(selling), 가격, 한마디
// DELETE /api/market/:id -> 글 내리기 (올린 사람, 또는 오피서 이상이 맞지 않는 글을 내릴 때)
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, paramId, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { MAX_NOTE, MAX_SELLING, listingOut, readNote, validPrice } from "../../../server/market";
import type { ListingRow } from "../../../server/market";

async function find(env: Env, params: Record<string, string | string[]>) {
  const id = Number(paramId(params));
  if (!Number.isInteger(id)) return null;
  return env.DB.prepare("SELECT * FROM listings WHERE id = ?").bind(id).first<ListingRow>();
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await find(env, params);
  if (!row) return json({ error: "없는 글이에요" }, 404);
  if (row.seller !== me.id) return FORBIDDEN();
  const body = await readJson<{ status: unknown; price: unknown; note: unknown }>(request);

  const status = body.status ?? row.status;
  if (status !== "selling" && status !== "sold") return json({ error: "상태가 맞지 않아요" }, 400);
  const price = body.price ?? row.price;
  if (!validPrice(price)) return json({ error: "가격을 골드로 적어 주세요" }, 400);
  if (row.mode === "auction" && price !== row.price) return json({ error: "경매는 시작가를 바꿀 수 없어요. 내리고 다시 올려 주세요" }, 400);
  const note = body.note === undefined ? row.note : readNote(body.note);
  if (note === undefined) return json({ error: `한마디는 ${MAX_NOTE}자까지예요` }, 400);
  if (status === "selling" && row.status === "sold") {
    const selling = await env.DB.prepare("SELECT COUNT(*) AS n FROM listings WHERE seller = ? AND status = 'selling'")
      .bind(me.id)
      .first<{ n: number }>();
    if ((selling?.n ?? 0) >= MAX_SELLING) return json({ error: `한 사람이 ${MAX_SELLING}개까지 팔 수 있어요` }, 409);
  }
  const updated = await env.DB.prepare("UPDATE listings SET status = ?, price = ?, note = ?, updated_at = ? WHERE id = ? RETURNING *")
    .bind(status, price, note, Date.now(), row.id)
    .first<ListingRow>();
  if (!updated) return json({ error: "없는 글이에요" }, 404);
  return json(listingOut(updated));
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await find(env, params);
  if (!row) return json({ error: "없는 글이에요" }, 404);
  if (row.seller !== me.id && RANK[me.role] < 1) return FORBIDDEN();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM listing_wants WHERE listing_id = ?").bind(row.id),
    env.DB.prepare("DELETE FROM listing_bids WHERE listing_id = ?").bind(row.id),
    env.DB.prepare("DELETE FROM listings WHERE id = ?").bind(row.id),
  ]);
  return json({ ok: true });
};
