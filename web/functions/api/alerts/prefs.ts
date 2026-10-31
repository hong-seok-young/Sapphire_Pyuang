// PUT /api/alerts/prefs { kind, on } -> 알림 종류 하나의 앱 알림 켜고 끄기 (메뉴별, 제작자 요청)
// PUT /api/alerts/prefs { kind, push } -> 그 종류의 폰 알림(푸시)만 켜고 끄기 (제작자 요청: 폰 팝업은 따로 설정)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { ALERT_KINDS, isAlertKind } from "../../../server/alerts";

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const { kind, on, push } = await readJson<{ kind: unknown; on: unknown; push: unknown }>(request);
  if (!isAlertKind(kind) || (typeof on !== "boolean" && typeof push !== "boolean")) return json({ error: "알림 종류가 맞지 않아요" }, 400);
  if (typeof on === "boolean") {
    await env.DB.prepare(
      "INSERT INTO alert_prefs (user_id, kind, enabled) VALUES (?, ?, ?) ON CONFLICT (user_id, kind) DO UPDATE SET enabled = excluded.enabled",
    )
      .bind(me.id, kind, on ? 1 : 0)
      .run();
  }
  if (typeof push === "boolean") {
    await env.DB.prepare(
      "INSERT INTO alert_prefs (user_id, kind, enabled, push) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, kind) DO UPDATE SET push = excluded.push",
    )
      .bind(me.id, kind, ALERT_KINDS[kind] ? 1 : 0, push ? 1 : 0)
      .run();
  }
  return json({ kind, on, push });
};
