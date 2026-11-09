// PUT /api/quest2/bands { bands: [{ minLevel, goldPerLevel }] } -> 레벨대별 보상 곡선을 통째로 바꾼다 (오피서 이상, '조정해도 됨')
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canManageQuest2, canUseQuest2, readBandsInput } from "../../../server/quest2";

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseQuest2(me) || !canManageQuest2(me.role)) return FORBIDDEN();
  const bands = readBandsInput(await readJson<Record<string, unknown>>(request));
  if (typeof bands === "string") return json({ error: bands }, 400);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM quest2_bands"),
    ...bands.map((b) => env.DB.prepare("INSERT INTO quest2_bands (min_level, gold_per_level) VALUES (?, ?)").bind(b.minLevel, b.goldPerLevel)),
  ]);
  return json({ ok: true });
};
