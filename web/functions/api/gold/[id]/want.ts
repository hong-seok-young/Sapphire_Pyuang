// PUT    /api/gold/:id/want { note? } -> '거래할래요' 누르기 (올라와 있는 남의 골드 글. 한마디는 올린 사람만 본다)
// DELETE /api/gold/:id/want         -> '거래할래요' 거두기
import { NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_NOTE, readNote } from "../../../../server/market";
import { notify } from "../../../../server/alerts";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  const row = Number.isInteger(id)
    ? await env.DB.prepare("SELECT owner, status, side, gold FROM gold_offers WHERE id = ?").bind(id)
        .first<{ owner: string; status: string; side: string; gold: number }>()
    : null;
  if (!row) return json({ error: "없는 글이에요" }, 404);
  if (row.owner === me.id) return json({ error: "내 글이에요" }, 400);
  if (row.status !== "open") return json({ error: "이미 거래가 끝났어요" }, 409);
  const note = readNote((await readJson<{ note: unknown }>(request)).note);
  if (note === undefined) return json({ error: `한마디는 ${MAX_NOTE}자까지예요` }, 400);
  await env.DB.prepare(
    "INSERT INTO gold_wants (offer_id, user_id, note, created_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT (offer_id, user_id) DO UPDATE SET note = excluded.note",
  )
    .bind(id, me.id, note, Date.now())
    .run();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM gold_wants WHERE offer_id = ?").bind(id).first<{ n: number }>();
  await notify(env, [row.owner], "gold_want", `${me.id}님이 골드 ${row.side === "sell" ? "팝니다" : "삽니다"} ${row.gold}만 글에 거래할래요`, "#/market", me.id);
  return json({ wants: n?.n ?? 1, wanted: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  if (!Number.isInteger(id)) return json({ error: "없는 글이에요" }, 404);
  await env.DB.prepare("DELETE FROM gold_wants WHERE offer_id = ? AND user_id = ?").bind(id, me.id).run();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM gold_wants WHERE offer_id = ?").bind(id).first<{ n: number }>();
  return json({ wants: n?.n ?? 0, wanted: false });
};
