// PATCH  /api/quest2/brackets/:id { minLevel?, maxLevel?, note? } -> 구간 고치기 (오피서 이상)
// DELETE /api/quest2/brackets/:id -> 구간 지우기 (오피서 이상)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_REWARD, canManageQuest2, canUseQuest2, text, validLevel } from "../../../../server/quest2";
import type { BracketRow } from "../../../../server/quest2";

async function find(env: Env, params: Record<string, string | string[]>) {
  const id = Number(paramId(params));
  if (!Number.isInteger(id)) return null;
  return env.DB.prepare("SELECT * FROM quest2_brackets WHERE id = ?").bind(id).first<BracketRow>();
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseQuest2(me) || !canManageQuest2(me.role)) return FORBIDDEN();
  const b = await find(env, params);
  if (!b) return json({ error: "없는 구간이에요" }, 404);
  const body = await readJson<{ minLevel: unknown; maxLevel: unknown; note: unknown }>(request);
  const minLevel = body.minLevel === undefined ? b.min_level : body.minLevel;
  const maxLevel = body.maxLevel === undefined ? b.max_level : body.maxLevel;
  if (!validLevel(minLevel) || !validLevel(maxLevel)) return json({ error: "레벨이 맞지 않아요" }, 400);
  if ((maxLevel as number) < (minLevel as number)) return json({ error: "끝 레벨이 시작 레벨보다 낮아요" }, 400);
  let note = b.note;
  if (body.note !== undefined) {
    const n = text(body.note, MAX_REWARD);
    if (!n) return json({ error: `안내는 ${MAX_REWARD}자 안으로 적어 주세요` }, 400);
    note = n;
  }
  await env.DB.prepare("UPDATE quest2_brackets SET min_level = ?, max_level = ?, note = ? WHERE id = ?").bind(minLevel, maxLevel, note, b.id).run();
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseQuest2(me) || !canManageQuest2(me.role)) return FORBIDDEN();
  const b = await find(env, params);
  if (!b) return json({ error: "없는 구간이에요" }, 404);
  await env.DB.prepare("DELETE FROM quest2_brackets WHERE id = ?").bind(b.id).run();
  return json({ ok: true });
};
