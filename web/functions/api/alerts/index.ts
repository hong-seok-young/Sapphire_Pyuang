// GET  /api/alerts -> 내 알림 (최근 60개), 안 읽은 수, 종류별 켜짐 (alert_prefs, 없으면 기본값)
// POST /api/alerts -> 모두 읽음
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { ALERT_KINDS } from "../../../server/alerts";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const [rows, unread, prefs] = await env.DB.batch([
    env.DB.prepare("SELECT id, kind, text, link, created_at AS at, read_at AS readAt FROM alerts WHERE user_id = ? ORDER BY id DESC LIMIT 60")
      .bind(me.id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND read_at IS NULL").bind(me.id),
    env.DB.prepare("SELECT kind, enabled FROM alert_prefs WHERE user_id = ?").bind(me.id),
  ]);
  const on: Record<string, boolean> = { ...ALERT_KINDS };
  for (const p of prefs.results as { kind: string; enabled: number }[]) if (p.kind in on) on[p.kind] = p.enabled === 1;
  return json({ alerts: rows.results, unread: (unread.results[0] as { n: number }).n, prefs: on });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  await env.DB.prepare("UPDATE alerts SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(Date.now(), me.id).run();
  return json({ ok: true });
};
