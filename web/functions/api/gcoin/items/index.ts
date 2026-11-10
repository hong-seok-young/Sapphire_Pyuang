// POST /api/gcoin/items { name, unit?, gold } (골드 원 단위, 코인 = gold / 1000 반올림. 0 = 값을 정하기 전) -> 상점 물건 더하기 (오피서 이상)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_GOLD, MAX_NAME, MAX_UNIT, canManageGcoin, canUseGcoin, coinOfGold, int, text } from "../../../../server/gcoin";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseGcoin(me) || !canManageGcoin(me)) return FORBIDDEN();
  const b = await readJson<{ name: unknown; unit: unknown; gold: unknown }>(request);
  const name = text(b.name, MAX_NAME);
  const unit = text(b.unit, MAX_UNIT);
  const gold = int(b.gold, 0, MAX_GOLD);
  if (!name) return json({ error: `이름을 ${MAX_NAME}자 안으로 적어 주세요` }, 400);
  if (unit === undefined) return json({ error: `단위는 ${MAX_UNIT}자까지예요` }, 400);
  if (gold === null) return json({ error: "골드 값이 맞지 않아요" }, 400);
  const sort = await env.DB.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM gc_items").first<{ n: number }>();
  await env.DB.prepare("INSERT INTO gc_items (name, unit, price, gold, active, sort) VALUES (?, ?, ?, ?, 1, ?)").bind(name, unit, coinOfGold(gold), gold, sort?.n ?? 1).run();
  return json({ ok: true }, 201);
};
