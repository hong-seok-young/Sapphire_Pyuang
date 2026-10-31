// GET  /api/gold -> 골드 거래: 올라와 있는 글 전부와 내 글(끝난 것 포함). 글마다 '거래할래요' 수와 내가 눌렀는지.
//      내 글에는 누른 사람 명단(wanters)도 준다 (명단은 올린 사람에게만)
// POST /api/gold { side: sell|buy, gold: 만 골드, rate: 1만 원에 만 골드, note } -> 골드 팝니다 / 삽니다 올리기
// 앱은 돈을 받거나 보내지 않는다 (server/gold.ts)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { MAX_OPEN_GOLD, SHOW_DONE_MS, goldOut, readGold } from "../../../server/gold";
import type { GoldRow } from "../../../server/gold";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const [rows, wanters] = await env.DB.batch([
    env.DB.prepare(
      "SELECT g.*, (SELECT COUNT(*) FROM gold_wants w WHERE w.offer_id = g.id) AS wants, " +
        "EXISTS (SELECT 1 FROM gold_wants w WHERE w.offer_id = g.id AND w.user_id = ?1) AS wanted " +
        "FROM gold_offers g WHERE g.status = 'open' OR (g.owner = ?1 AND g.updated_at >= ?2) ORDER BY g.created_at DESC",
    ).bind(me.id, Date.now() - SHOW_DONE_MS),
    env.DB.prepare(
      "SELECT w.offer_id AS offer_id, w.user_id AS user_id, w.note AS note, w.created_at AS created_at " +
        "FROM gold_wants w JOIN gold_offers g ON g.id = w.offer_id WHERE g.owner = ? ORDER BY w.created_at",
    ).bind(me.id),
  ]);
  const byOffer = new Map<number, { id: string; note: string | null; at: number }[]>();
  for (const w of wanters.results as { offer_id: number; user_id: string; note: string | null; created_at: number }[]) {
    const list = byOffer.get(w.offer_id) ?? [];
    list.push({ id: w.user_id, note: w.note, at: w.created_at });
    byOffer.set(w.offer_id, list);
  }
  return json({
    offers: (rows.results as (GoldRow & { wants: number; wanted: number })[]).map((r) => ({
      ...goldOut(r),
      wants: r.wants,
      wanted: r.wanted === 1,
      ...(r.owner === me.id ? { wanters: byOffer.get(r.id) ?? [] } : {}),
    })),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const input = readGold(await readJson<Record<string, unknown>>(request));
  if (typeof input === "string") return json({ error: input }, 400);
  const now = Date.now();
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM gold_offers WHERE owner = ? AND status = 'open'")
    .bind(me.id)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_GOLD) return json({ error: `골드 글은 한 사람이 ${MAX_OPEN_GOLD}개까지예요. 끝난 글은 '거래 완료'를 눌러 주세요` }, 409);
  const row = await env.DB.prepare(
    "INSERT INTO gold_offers (owner, side, gold, rate, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?) RETURNING *",
  )
    .bind(me.id, input.side, input.gold, input.rate, input.note, now, now)
    .first<GoldRow>();
  if (!row) return json({ error: "올리지 못했어요" }, 500);
  return json({ ...goldOut(row), wants: 0, wanted: false, wanters: [] }, 201);
};
