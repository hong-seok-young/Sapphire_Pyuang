// GET  /api/market/:id/talk -> 종목 토론방 글 (제작자 요청: 물건마다 가격이 어떤지, 뉴비가 살지 물어보고 판매자가 답하는 방)
// POST /api/market/:id/talk { text } -> 글 쓰기 (200자, 한 사람 1분에 5개까지). 판 사람과 그 방에 쓴 사람에게 알림
import { NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env, Role } from "../../../../server/auth";
import { itemName, notify } from "../../../../server/alerts";

const MAX_TALK = 200;
const PER_MINUTE = 5;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  if (!Number.isInteger(id)) return json({ error: "없는 글이에요" }, 404);
  const rows = await env.DB.prepare(
    "SELECT t.id AS id, t.user_id AS user, u.role AS role, t.text AS text, t.created_at AS at FROM listing_talk t " +
      "LEFT JOIN users u ON u.id = t.user_id WHERE t.listing_id = ? ORDER BY t.id LIMIT 300",
  )
    .bind(id)
    .all<{ id: number; user: string; role: Role | null; text: string; at: number }>();
  return json({ talk: rows.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  const listing = Number.isInteger(id)
    ? await env.DB.prepare("SELECT seller, item, enhance FROM listings WHERE id = ?").bind(id).first<{ seller: string; item: string; enhance: number }>()
    : null;
  if (!listing) return json({ error: "없는 글이에요" }, 404);
  const { text } = await readJson<{ text: unknown }>(request);
  const body = typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
  if (!body || body.length > MAX_TALK) return json({ error: `글은 1~${MAX_TALK}자로 써 주세요` }, 400);
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM listing_talk WHERE user_id = ? AND created_at > ?")
    .bind(me.id, now - 60_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= PER_MINUTE) return json({ error: "조금 천천히 써 주세요 (1분에 5개까지)" }, 429);
  const row = await env.DB.prepare("INSERT INTO listing_talk (listing_id, user_id, text, created_at) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(id, me.id, body, now)
    .first<{ id: number }>();
  const others = await env.DB.prepare("SELECT DISTINCT user_id FROM listing_talk WHERE listing_id = ?").bind(id).all<{ user_id: string }>();
  const to = [...new Set([listing.seller, ...others.results.map((r) => r.user_id)])];
  await notify(env, to, "talk", `${itemName(listing)} 토론방 · ${me.id}: ${body}`, "#/market", me.id);
  return json({ id: row?.id, user: me.id, role: me.role, text: body, at: now }, 201);
};
