// PUT /api/profile { job, level, exp? } -> 내 직업, 레벨, 경험치 % (처음 정하는 창과 '내 정보'에서)
// exp 는 경험치 % x 1000 (12.345% -> 12345). 비우면 null, 안 보내면(예전 화면) 그대로 둔다
import { NEED_LOGIN, currentUser, json, readJson, readProfile, saveProfile } from "../../server/auth";
import type { Env } from "../../server/auth";

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const p = readProfile(await readJson<{ job: unknown; level: unknown; exp: unknown }>(request));
  if (!p) return json({ error: "직업을 고르고 레벨을 1~99, 경험치를 0~99.999% 로 넣어 주세요" }, 400);
  await saveProfile(env, me.id, p.job, p.level, me.id, p.exp);
  return json(p);
};
