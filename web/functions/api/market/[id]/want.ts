// PUT    /api/market/:id/want { note? } -> '살래요' 누르기 (판매 중인 남의 글. 한마디는 판 사람만 본다)
// DELETE /api/market/:id/want         -> '살래요' 거두기
import { NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_NOTE, readNote } from "../../../../server/market";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  const row = Number.isInteger(id)
    ? await env.DB.prepare("SELECT seller, status FROM listings WHERE id = ?").bind(id).first<{ seller: string; status: string }>()
    : null;
  if (!row) return json({ error: "없는 글이에요" }, 404);
  if (row.seller === me.id) return json({ error: "내 물건이에요" }, 400);
  if (row.status !== "selling") return json({ error: "이미 거래가 끝났어요" }, 409);
  const note = readNote((await readJson<{ note: unknown }>(request)).note);
  if (note === undefined) return json({ error: `한마디는 ${MAX_NOTE}자까지예요` }, 400);
  await env.DB.prepare(
    "INSERT INTO listing_wants (listing_id, user_id, note, created_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT (listing_id, user_id) DO UPDATE SET note = excluded.note",
  )
    .bind(id, me.id, note, Date.now())
    .run();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM listing_wants WHERE listing_id = ?").bind(id).first<{ n: number }>();
  return json({ wants: n?.n ?? 1, wanted: true });
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
