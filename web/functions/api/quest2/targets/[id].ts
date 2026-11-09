// PATCH  /api/quest2/targets/:id { startLevel?, endLevel?, note? } -> 목표 고치기 (오피서 이상)
// DELETE /api/quest2/targets/:id -> 목표 내리기 (신청 기록도 같이. 오피서 이상)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { MAX_NOTE, canManageQuest2, canUseQuest2, text, validLevel } from "../../../../server/quest2";
import type { TargetRow } from "../../../../server/quest2";

async function find(env: Env, params: Record<string, string | string[]>) {
  const id = Number(paramId(params));
  if (!Number.isInteger(id)) return null;
  return env.DB.prepare("SELECT * FROM quest2_targets WHERE id = ?").bind(id).first<TargetRow>();
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseQuest2(me) || !canManageQuest2(me.role)) return FORBIDDEN();
  const t = await find(env, params);
  if (!t) return json({ error: "없는 목표예요" }, 404);
  const body = await readJson<{ startLevel: unknown; endLevel: unknown; note: unknown }>(request);
  const startLevel = body.startLevel === undefined ? t.start_level : body.startLevel;
  const endLevel = body.endLevel === undefined ? t.end_level : body.endLevel;
  if (!validLevel(startLevel) || !validLevel(endLevel)) return json({ error: "레벨이 맞지 않아요" }, 400);
  if ((endLevel as number) < (startLevel as number)) return json({ error: "목표 레벨이 시작 레벨보다 낮아요" }, 400);
  let note = t.note;
  if (body.note !== undefined) {
    const n = text(body.note, MAX_NOTE);
    if (n === undefined) return json({ error: `쪽지는 ${MAX_NOTE}자까지예요` }, 400);
    note = n;
  }
  await env.DB.prepare("UPDATE quest2_targets SET start_level = ?, end_level = ?, note = ?, updated_at = ? WHERE id = ?")
    .bind(startLevel, endLevel, note, Date.now(), t.id)
    .run();
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseQuest2(me) || !canManageQuest2(me.role)) return FORBIDDEN();
  const t = await find(env, params);
  if (!t) return json({ error: "없는 목표예요" }, 404);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM quest2_claims WHERE target_id = ?").bind(t.id),
    env.DB.prepare("DELETE FROM quest2_targets WHERE id = ?").bind(t.id),
  ]);
  return json({ ok: true });
};
