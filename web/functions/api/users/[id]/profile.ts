// PUT /api/users/:id/profile { job, level } -> 다른 사람의 직업과 레벨 고치기 (오피서 이상, 잘못 고른 것을 바로잡을 때)
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, paramId, readJson, readProfile, saveProfile } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (RANK[me.role] < 1) return FORBIDDEN();
  const id = paramId(params);
  const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first<{ id: string }>();
  if (!user) return json({ error: "없는 아이디예요" }, 404);
  const p = readProfile(await readJson<{ job: unknown; level: unknown }>(request));
  if (!p) return json({ error: "직업을 고르고 레벨을 1~99 로 넣어 주세요" }, 400);
  await saveProfile(env, user.id, p.job, p.level, me.id);
  return json({ id: user.id, ...p });
};
