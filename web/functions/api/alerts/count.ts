// GET /api/alerts/count -> 안 읽은 알림 수 (화면 위 🔔 의 빨간 숫자, 1분마다 묻는다)
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND read_at IS NULL").bind(me.id).first<{ n: number }>();
  return json({ unread: r?.n ?? 0 });
};
