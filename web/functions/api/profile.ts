// PUT /api/profile { job, level } -> 내 직업과 레벨 (처음 정하는 창과 '내 정보'에서)
import { NEED_LOGIN, currentUser, json, readJson, readProfile, saveProfile } from "../../server/auth";
import type { Env } from "../../server/auth";

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const p = readProfile(await readJson<{ job: unknown; level: unknown }>(request));
  if (!p) return json({ error: "직업을 고르고 레벨을 1~99 로 넣어 주세요" }, 400);
  await saveProfile(env, me.id, p.job, p.level, me.id);
  return json(p);
};
