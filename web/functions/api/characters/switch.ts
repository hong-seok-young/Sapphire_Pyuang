// POST /api/characters/switch { to } -> 같은 사람의 다른 캐릭터로 바꾸기 (부캐 묶기, 👤 의 캐릭터 목록).
// 같이 쓰는 캐릭터(char_shares)로도 바꾼다 (제작자 2026-11-25 '뼈 부주'). 지금 로그인(세션)을 그 캐릭터로 옮긴다. 화면은 받은 내 정보로 다시 그린다
import { NEED_LOGIN, currentUser, json, meInfo, readJson, sessionToken, switchCharacter, userOfToken } from "../../../server/auth";
import type { Env } from "../../../server/auth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const { to } = await readJson<{ to: unknown }>(request);
  if (typeof to !== "string" || !(await switchCharacter(env, request, me, to))) return json({ error: "내 캐릭터가 아니에요" }, 403);
  const user = await userOfToken(env, sessionToken(request)!);
  if (!user) return NEED_LOGIN();
  return json(await meInfo(env, user));
};
