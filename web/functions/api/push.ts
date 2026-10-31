// GET    /api/push              -> 구독에 쓸 공개 키 { publicKey } (server/push.ts)
// PUT    /api/push { endpoint } -> 이 폰으로 폰 알림 받기. 한 사람 폰 5대까지
// DELETE /api/push { endpoint } -> 이 폰은 그만 받기
import { NEED_LOGIN, currentUser, json, readJson } from "../../server/auth";
import type { Env } from "../../server/auth";
import { vapidKeys } from "../../server/push";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  return json({ publicKey: (await vapidKeys(env)).publicKey });
};

const okEndpoint = (e: unknown): e is string => typeof e === "string" && /^https:\/\//.test(e) && e.length <= 1000;

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ endpoint: unknown }>(request);
  if (!okEndpoint(b.endpoint)) return json({ error: "알림 주소가 맞지 않아요" }, 400);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO push_subs (endpoint, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, created_at = excluded.created_at",
    ).bind(b.endpoint, me.id, now),
    // 오래된 폰부터 정리해서 5대까지
    env.DB.prepare(
      "DELETE FROM push_subs WHERE user_id = ?1 AND endpoint NOT IN (SELECT endpoint FROM push_subs WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 5)",
    ).bind(me.id),
  ]);
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ endpoint: unknown }>(request);
  if (!okEndpoint(b.endpoint)) return json({ error: "알림 주소가 맞지 않아요" }, 400);
  await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?").bind(b.endpoint, me.id).run();
  return json({ ok: true });
};
