// PUT /api/users/:id/highspec { on } -> 고스펙 길드원 표시 (오피서 이상, 제작자 요청). 랭킹과 길드원 관리에 '고스펙'으로 보이고
//     플래티넘 할인 상점에서 고스펙 할인가로 산다
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (RANK[me.role] < 1) return FORBIDDEN();
  const { on } = await readJson<{ on: unknown }>(request);
  if (typeof on !== "boolean") return json({ error: "고스펙 표시가 맞지 않아요" }, 400);
  const res = await env.DB.prepare("UPDATE users SET high_spec = ? WHERE id = ?").bind(on ? 1 : 0, paramId(params)).run();
  if (!res.meta.changes) return json({ error: "없는 아이디예요" }, 404);
  return json({ id: paramId(params), highSpec: on });
};
