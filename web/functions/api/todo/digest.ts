// POST /api/todo/digest -> { done } : To do 화면이 아직 정리 안 된 새 공식 글을 볼 때, 서버가 최근 글 2개까지를 맡아 Claude 로 할 일을 뽑는다.
// 보통은 GitHub Actions 가 미리 정리해 둔다 (scripts/digest-official.mjs). 화면이 답을 기다리는 동안 하고, 화면을 닫아도 뒤에서 마저 한다.
// 다른 곳이 맡은 글은 건드리지 않는다 (server/todo.ts digestPending). 사람이 한 일이 아니라서 사용 기록에 남기지 않는다 (functions/api/_middleware.ts)
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { digestPending } from "../../../server/todo";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const work = digestPending(env, 2).catch((e) => {
    console.error("todo digest", e);
    return 0;
  });
  waitUntil(work);
  return json({ done: await work });
};
