// PATCH  /api/gcoin/items/:id { name?, unit?, price?, info?, active? } -> 물건 고치기·판매 중지 (오피서 이상)
// DELETE /api/gcoin/items/:id -> 물건 지우기 (이미 한 신청은 이름·값을 따로 남겨 두어 그대로 보인다)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_INFO, MAX_NAME, MAX_PRICE, MAX_UNIT, canManageGcoin, canUseGcoin, int, text } from "../../../../server/gcoin";

async function guard(env: Env, request: Request, params: Record<string, string | string[]>) {
  const me = await currentUser(env, request);
  if (!me) return { res: NEED_LOGIN() };
  if (!canUseGcoin(me) || !canManageGcoin(me.role)) return { res: FORBIDDEN() };
  const id = Number(paramId(params));
  const it = Number.isInteger(id)
    ? await env.DB.prepare("SELECT id, name, unit, price, info, active FROM gc_items WHERE id = ?").bind(id).first<{
        id: number;
        name: string;
        unit: string | null;
        price: number;
        info: string | null;
        active: number;
      }>()
    : null;
  if (!it) return { res: json({ error: "없는 물건이에요" }, 404) };
  return { it };
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const g = await guard(env, request, params);
  if (!g.it) return g.res;
  const b = await readJson<{ name: unknown; unit: unknown; price: unknown; info: unknown; active: unknown }>(request);
  let { name, unit, price, info, active } = g.it;
  if (b.name !== undefined) {
    const n = text(b.name, MAX_NAME);
    if (!n) return json({ error: `이름을 ${MAX_NAME}자 안으로 적어 주세요` }, 400);
    name = n;
  }
  if (b.unit !== undefined) {
    const u = text(b.unit, MAX_UNIT);
    if (u === undefined) return json({ error: `단위는 ${MAX_UNIT}자까지예요` }, 400);
    unit = u;
  }
  if (b.price !== undefined) {
    const p = int(b.price, 0, MAX_PRICE);
    if (p === null) return json({ error: "값이 맞지 않아요" }, 400);
    price = p;
  }
  if (b.info !== undefined) {
    const t = text(b.info, MAX_INFO);
    if (t === undefined) return json({ error: `옵션은 ${MAX_INFO}자까지예요` }, 400);
    info = t;
  }
  if (b.active !== undefined) active = b.active === true ? 1 : 0;
  await env.DB.prepare("UPDATE gc_items SET name = ?, unit = ?, price = ?, info = ?, active = ? WHERE id = ?").bind(name, unit, price, info, active, g.it.id).run();
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const g = await guard(env, request, params);
  if (!g.it) return g.res;
  await env.DB.prepare("DELETE FROM gc_items WHERE id = ?").bind(g.it.id).run();
  return json({ ok: true });
};
