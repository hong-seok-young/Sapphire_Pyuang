// POST /api/gcoin/items { name, unit?, price, info? } (price 0 = 골드 값을 정하기 전) -> 상점 물건 더하기 (오피서 이상)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_INFO, MAX_NAME, MAX_PRICE, MAX_UNIT, canManageGcoin, canUseGcoin, int, text } from "../../../../server/gcoin";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseGcoin(me) || !canManageGcoin(me.role)) return FORBIDDEN();
  const b = await readJson<{ name: unknown; unit: unknown; price: unknown; info: unknown }>(request);
  const name = text(b.name, MAX_NAME);
  const unit = text(b.unit, MAX_UNIT);
  const price = int(b.price, 0, MAX_PRICE);
  if (!name) return json({ error: `이름을 ${MAX_NAME}자 안으로 적어 주세요` }, 400);
  if (unit === undefined) return json({ error: `단위는 ${MAX_UNIT}자까지예요` }, 400);
  if (price === null) return json({ error: "값이 맞지 않아요" }, 400);
  const info = text(b.info, MAX_INFO);
  if (info === undefined) return json({ error: `옵션은 ${MAX_INFO}자까지예요` }, 400);
  const sort = await env.DB.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM gc_items").first<{ n: number }>();
  await env.DB.prepare("INSERT INTO gc_items (name, unit, price, info, active, sort) VALUES (?, ?, ?, ?, 1, ?)").bind(name, unit, price, info, sort?.n ?? 1).run();
  return json({ ok: true }, 201);
};
