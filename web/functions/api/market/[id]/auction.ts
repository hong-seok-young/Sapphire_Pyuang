// POST /api/market/:id/auction { hours } -> '살래요'가 2명 이상인 내 판매 글을 경매로 바꾼다 (제작자 요청).
// 가격이 시작가가 되고, '살래요'를 누른 사람들에게 입찰하라는 알림이 간다 (server/market.ts toAuction)
import { NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { AUCTION_HOURS, WANTS_FOR_AUCTION, toAuction } from "../../../../server/market";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  const row = Number.isInteger(id)
    ? await env.DB.prepare(
        "SELECT seller, status, mode, (SELECT COUNT(*) FROM listing_wants w WHERE w.listing_id = listings.id) AS wants FROM listings WHERE id = ?",
      )
        .bind(id)
        .first<{ seller: string; status: string; mode: string; wants: number }>()
    : null;
  if (!row) return json({ error: "없는 글이에요" }, 404);
  if (row.seller !== me.id) return json({ error: "내 글만 바꿀 수 있어요" }, 403);
  if (row.status !== "selling" || row.mode !== "sale") return json({ error: "판매 중인 글만 경매로 바꿀 수 있어요" }, 409);
  if (row.wants < WANTS_FOR_AUCTION) return json({ error: `'살래요'가 ${WANTS_FOR_AUCTION}명 이상일 때 바꿀 수 있어요` }, 409);
  const { hours } = await readJson<{ hours: unknown }>(request);
  if (!AUCTION_HOURS.includes(hours as number)) return json({ error: "경매 시간을 골라 주세요" }, 400);
  const endsAt = await toAuction(env, id, hours as number, me.id, false);
  if (endsAt === null) return json({ error: "바꾸지 못했어요. 다시 해 주세요" }, 409);
  return json({ mode: "auction", endsAt, autoAuction: null });
};
