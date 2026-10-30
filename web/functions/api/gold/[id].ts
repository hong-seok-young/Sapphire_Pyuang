// PATCH  /api/gold/:id { status?, gold?, rate?, note? } -> 내 골드 글 고치기: 거래 완료(done), 다시 올리기(open), 양, 시세, 한마디
// DELETE /api/gold/:id -> 골드 글 내리기 (올린 사람, 또는 오피서 이상)
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, paramId, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { MAX_OPEN_GOLD, goldOut, validGold, validRate } from "../../../server/gold";
import type { GoldRow } from "../../../server/gold";
import { MAX_NOTE, readNote } from "../../../server/market";

async function find(env: Env, params: Record<string, string | string[]>) {
  const id = Number(paramId(params));
  if (!Number.isInteger(id)) return null;
  return env.DB.prepare("SELECT * FROM gold_offers WHERE id = ?").bind(id).first<GoldRow>();
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await find(env, params);
  if (!row) return json({ error: "없는 글이에요" }, 404);
  if (row.owner !== me.id) return FORBIDDEN();
  const body = await readJson<{ status: unknown; gold: unknown; rate: unknown; note: unknown }>(request);
  const status = body.status ?? row.status;
  if (status !== "open" && status !== "done") return json({ error: "상태가 맞지 않아요" }, 400);
  const gold = body.gold ?? row.gold;
  if (!validGold(gold)) return json({ error: "골드는 만 골드 단위로 적어 주세요" }, 400);
  const rate = body.rate ?? row.rate;
  if (!validRate(rate)) return json({ error: "시세는 1만 원에 몇 만 골드인지 적어 주세요" }, 400);
  const note = body.note === undefined ? row.note : readNote(body.note);
  if (note === undefined) return json({ error: `한마디는 ${MAX_NOTE}자까지예요` }, 400);
  if (status === "open" && row.status === "done") {
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM gold_offers WHERE owner = ? AND status = 'open'")
      .bind(me.id)
      .first<{ n: number }>();
    if ((open?.n ?? 0) >= MAX_OPEN_GOLD) return json({ error: `골드 글은 한 사람이 ${MAX_OPEN_GOLD}개까지예요` }, 409);
  }
  const updated = await env.DB.prepare("UPDATE gold_offers SET status = ?, gold = ?, rate = ?, note = ?, updated_at = ? WHERE id = ? RETURNING *")
    .bind(status, gold, rate, note, Date.now(), row.id)
    .first<GoldRow>();
  if (!updated) return json({ error: "없는 글이에요" }, 404);
  return json(goldOut(updated));
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await find(env, params);
  if (!row) return json({ error: "없는 글이에요" }, 404);
  if (row.owner !== me.id && RANK[me.role] < 1) return FORBIDDEN();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM gold_wants WHERE offer_id = ?").bind(row.id),
    env.DB.prepare("DELETE FROM gold_offers WHERE id = ?").bind(row.id),
  ]);
  return json({ ok: true });
};
