// PUT    /api/market/:id/want { note?, offer? } -> '살래요' 누르기 (판매 중인 남의 글).
//        offer 는 흥정 가격(골드). 한마디와 흥정 가격은 판 사람만 본다. 경매는 입찰(bids)로 한다
// DELETE /api/market/:id/want         -> '살래요' 거두기
import { NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_NOTE, readNote, validPrice } from "../../../../server/market";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  const row = Number.isInteger(id)
    ? await env.DB.prepare("SELECT seller, status, mode FROM listings WHERE id = ?").bind(id).first<{ seller: string; status: string; mode: string }>()
    : null;
  if (!row) return json({ error: "없는 글이에요" }, 404);
  if (row.seller === me.id) return json({ error: "내 물건이에요" }, 400);
  if (row.status !== "selling") return json({ error: "이미 거래가 끝났어요" }, 409);
  if (row.mode === "auction") return json({ error: "경매는 입찰로 해요" }, 400);
  const body = await readJson<{ note: unknown; offer: unknown }>(request);
  const note = readNote(body.note);
  if (note === undefined) return json({ error: `한마디는 ${MAX_NOTE}자까지예요` }, 400);
  const offer = body.offer === undefined || body.offer === null ? null : body.offer;
  if (offer !== null && !validPrice(offer)) return json({ error: "흥정 가격을 골드로 적어 주세요" }, 400);
  await env.DB.prepare(
    "INSERT INTO listing_wants (listing_id, user_id, note, offer, created_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (listing_id, user_id) DO UPDATE SET note = excluded.note, offer = excluded.offer",
  )
    .bind(id, me.id, note, offer, Date.now())
    .run();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM listing_wants WHERE listing_id = ?").bind(id).first<{ n: number }>();
  return json({ wants: n?.n ?? 1, wanted: true, myOffer: offer });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  if (!Number.isInteger(id)) return json({ error: "없는 글이에요" }, 404);
  await env.DB.prepare("DELETE FROM listing_wants WHERE listing_id = ? AND user_id = ?").bind(id, me.id).run();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM listing_wants WHERE listing_id = ?").bind(id).first<{ n: number }>();
  return json({ wants: n?.n ?? 0, wanted: false });
};
