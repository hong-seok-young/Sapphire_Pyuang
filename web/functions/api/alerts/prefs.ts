// PUT /api/alerts/prefs { kind, on } -> 알림 종류 하나 켜고 끄기 (메뉴별, 제작자 요청)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { isAlertKind } from "../../../server/alerts";

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const { kind, on } = await readJson<{ kind: unknown; on: unknown }>(request);
  if (!isAlertKind(kind) || typeof on !== "boolean") return json({ error: "알림 종류가 맞지 않아요" }, 400);
  await env.DB.prepare(
    "INSERT INTO alert_prefs (user_id, kind, enabled) VALUES (?, ?, ?) ON CONFLICT (user_id, kind) DO UPDATE SET enabled = excluded.enabled",
  )
    .bind(me.id, kind, on ? 1 : 0)
    .run();
  return json({ kind, on });
};
