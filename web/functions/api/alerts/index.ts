// GET  /api/alerts -> 내 알림 (최근 60개), 안 읽은 수, 종류별 켜짐 (alert_prefs, 없으면 기본값)
// POST /api/alerts -> 모두 읽음
// 부캐 묶기: 내 캐릭터들의 알림을 모두 같이 본다 (제작자 요청 2026-11-01). 다른 캐릭터의 알림은 who 에 그 캐릭터를 적고,
// link 는 그 캐릭터로 바꾼 뒤 그 화면으로 가는 #/as/캐릭터?to=원래 주소 로 준다 (폰 알림을 눌러도 같다, public/sw.js)
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { ALERT_KINDS } from "../../../server/alerts";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const mine = "user_id IN (SELECT id FROM users WHERE id = ?1 OR main_id = ?1)";
  const owner = me.owner ?? me.id;
  const [rows, unread, prefs] = await env.DB.batch([
    env.DB.prepare(`SELECT id, kind, text, link, created_at AS at, read_at AS readAt, user_id AS who FROM alerts INDEXED BY alerts_user WHERE ${mine} ORDER BY id DESC LIMIT 60`)
      .bind(owner),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE ${mine} AND read_at IS NULL`).bind(owner),
    env.DB.prepare("SELECT kind, enabled, push FROM alert_prefs WHERE user_id = ?").bind(me.id),
  ]);
  const on: Record<string, boolean> = { ...ALERT_KINDS };
  const push: Record<string, boolean> = Object.fromEntries(Object.keys(ALERT_KINDS).map((k) => [k, true]));
  for (const p of prefs.results as { kind: string; enabled: number; push: number | null }[]) {
    if (!(p.kind in on)) continue;
    on[p.kind] = p.enabled === 1;
    if (p.push !== null) push[p.kind] = p.push === 1;
  }
  const alerts = (rows.results as { link: string | null; who: string }[]).map(({ who, ...a }) =>
    who === me.id ? a : { ...a, who, link: `#/as/${encodeURIComponent(who)}?to=${encodeURIComponent(a.link ?? "#/alerts")}` },
  );
  return json({ alerts, unread: (unread.results[0] as { n: number }).n, prefs: on, pushPrefs: push });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  await env.DB.prepare("UPDATE alerts SET read_at = ?1 WHERE user_id IN (SELECT id FROM users WHERE id = ?2 OR main_id = ?2) AND read_at IS NULL")
    .bind(Date.now(), me.owner ?? me.id)
    .run();
  return json({ ok: true });
};
