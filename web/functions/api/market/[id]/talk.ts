// GET  /api/market/:id/talk -> 종목 토론방 글 (제작자 요청: 물건마다 가격이 어떤지, 뉴비가 살지 물어보고 판매자가 답하는 방)
// POST /api/market/:id/talk { text, parent? } -> 글 쓰기 (200자, 한 사람 1분에 5개까지). parent 를 주면 그 글의 답글 (한 단계만).
//      판 사람과 그 방에 쓴 사람에게 새 글 알림, 답글이면 원래 글쓴이에게 답글 알림
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
    "SELECT t.id AS id, t.parent_id AS parent, t.user_id AS user, u.role AS role, t.text AS text, t.created_at AS at FROM listing_talk t " +
      "LEFT JOIN users u ON u.id = t.user_id WHERE t.listing_id = ? ORDER BY t.id LIMIT 300",
  )
    .bind(id)
    .all<{ id: number; parent: number | null; user: string; role: Role | null; text: string; at: number }>();
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
  const { text, parent: parentIn } = await readJson<{ text: unknown; parent: unknown }>(request);
  const body = typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
  if (!body || body.length > MAX_TALK) return json({ error: `글은 1~${MAX_TALK}자로 써 주세요` }, 400);
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM listing_talk WHERE user_id = ? AND created_at > ?")
    .bind(me.id, now - 60_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= PER_MINUTE) return json({ error: "조금 천천히 써 주세요 (1분에 5개까지)" }, 429);
  // 답글: 같은 방의 글에만, 답글에 단 답글은 원래 글에 붙인다
  let parent: { id: number; user_id: string } | null = null;
  if (parentIn !== undefined && parentIn !== null) {
    const p = Number.isInteger(parentIn)
      ? await env.DB.prepare("SELECT id, user_id, parent_id FROM listing_talk WHERE id = ? AND listing_id = ?")
          .bind(parentIn, id)
          .first<{ id: number; user_id: string; parent_id: number | null }>()
      : null;
    if (!p) return json({ error: "답글을 달 글이 없어요" }, 404);
    parent = p.parent_id
      ? await env.DB.prepare("SELECT id, user_id FROM listing_talk WHERE id = ?").bind(p.parent_id).first<{ id: number; user_id: string }>()
      : p;
    if (!parent) return json({ error: "답글을 달 글이 없어요" }, 404);
  }
  const row = await env.DB.prepare(
    "INSERT INTO listing_talk (listing_id, user_id, text, created_at, parent_id) VALUES (?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(id, me.id, body, now, parent?.id ?? null)
    .first<{ id: number }>();
  const others = await env.DB.prepare("SELECT DISTINCT user_id FROM listing_talk WHERE listing_id = ?").bind(id).all<{ user_id: string }>();
  const to = [...new Set([listing.seller, ...others.results.map((r) => r.user_id)])].filter((u) => u !== parent?.user_id);
  await notify(env, to, "talk", `${itemName(listing)} 토론방 · ${me.id}: ${body}`, "#/market", me.id);
  if (parent) await notify(env, [parent.user_id], "talk", `${me.id}님이 내 글에 답글 (${itemName(listing)}): ${body}`, "#/market", me.id);
  return json({ id: row?.id, parent: parent?.id ?? null, user: me.id, role: me.role, text: body, at: now }, 201);
};
