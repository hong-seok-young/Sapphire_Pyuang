// GET /api/todo/people -> { people: [{ id, job, level, guild }] } : To do 를 함께 할 수 있는 사람 (나 빼고. 열기 전에는 앱개발자와 테스트 계정만)
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { shareablePeople } from "../../../server/todo";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  return json({ people: await shareablePeople(env, me.id) });
};
