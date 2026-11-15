// POST /api/gcoin/gift-seen -> 1군 담당자가 더 준 코인 팝업을 봤다고 적는다 (그 뒤 받은 것만 다음에 다시 뜬다, 홈 칸 배지도 사라진다)
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { GIFT_SEEN } from "../../../server/gcoin";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  await env.DB.prepare("INSERT INTO gc_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(`${GIFT_SEEN}${me.id}`, Date.now())
    .run();
  return json({ ok: true });
};
