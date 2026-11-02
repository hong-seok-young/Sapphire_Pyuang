// POST /api/rent/:id/return-request { when?, cancel? } -> 빌린 사람이 '반납 신청' (제작자 요청 2026-11-02: 장비 반납도 신청하게,
// 신청하고 나서 언제 할지 정하게 대화창이 있어야 한다). 운영진에게 알림이 가고 '운영 > 장비반납'에 '반납 신청'으로 맨 위에 보인다.
// 대화창: 그 무기를 빌린 신청서의 대화창을 그대로 쓰고, 없으면(카톡 목록, 대여 등록으로 빌린 것) 새로 만든다 (rental_items.return_app_id).
// when(언제 돌려줄 수 있는지, 40자)을 적으면 대화창 첫 줄로 남는다. 담당자가 게임 안에서 돌려받고 '반납'을 누르면 끝난다 (return.ts 가 비운다).
// cancel 이면 신청을 거둔다 (대화는 남긴다). 빌린 사람(묶은 캐릭터 모두)만
import { FORBIDDEN, NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { canEnter, itemLabel, notifyManagers } from "../../../../server/rental";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me)) return FORBIDDEN();
  const id = Number(paramId(params));
  const b = await readJson<{ cancel?: unknown; when?: unknown }>(request);
  const owner = me.owner ?? me.id;
  const item = await env.DB.prepare(
    "SELECT id, weapon, enhance, renter, return_req_at, return_app_id FROM rental_items WHERE id = ?1 AND status = 'open' AND renter IN (SELECT id FROM users WHERE id = ?2 OR main_id = ?2)",
  )
    .bind(id, owner)
    .first<{ id: number; weapon: string; enhance: number; renter: string; return_req_at: number | null; return_app_id: number | null }>();
  if (!item) return json({ error: "내가 빌린 무기가 아니에요" }, 404);
  const now = Date.now();
  if (b.cancel === true) {
    await env.DB.prepare("UPDATE rental_items SET return_req_at = NULL WHERE id = ?").bind(id).run();
    if (item.return_app_id) {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO rental_talk (app_id, user_id, text, created_at) VALUES (?, ?, ?, ?)").bind(item.return_app_id, me.id, `${itemLabel(item)} 반납 신청 취소`, now),
        env.DB.prepare("UPDATE rental_apps SET updated_at = ? WHERE id = ?").bind(now, item.return_app_id),
      ]);
    }
    return json({ ok: true, returnReqAt: null, returnAppId: item.return_app_id });
  }
  if (item.return_req_at) return json({ ok: true, returnReqAt: item.return_req_at, returnAppId: item.return_app_id });
  const when = typeof b.when === "string" ? b.when.trim().slice(0, 40) : "";
  // 대화창: 이번 대여의 신청서, 없으면 새 신청서(대화만 담는다)
  let appId = item.return_app_id;
  if (!appId) {
    const lent = await env.DB.prepare(
      "SELECT id, app_id FROM rental_requests WHERE item_id = ? AND status = 'done' AND returned_at IS NULL ORDER BY done_at DESC LIMIT 1",
    )
      .bind(id)
      .first<{ id: number; app_id: number | null }>();
    appId = lent?.app_id ?? null;
    if (!appId) {
      const app = await env.DB.prepare("INSERT INTO rental_apps (user_id, note, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING id")
        .bind(item.renter, `${itemLabel(item)} 반납`, now, now)
        .first<{ id: number }>();
      appId = app?.id ?? null;
      if (appId && lent) await env.DB.prepare("UPDATE rental_requests SET app_id = ? WHERE id = ?").bind(appId, lent.id).run();
    }
  }
  const text = `${itemLabel(item)} 반납 신청${when ? ` · ${when}` : ""}`;
  await env.DB.batch([
    env.DB.prepare("UPDATE rental_items SET return_req_at = ?, return_app_id = ? WHERE id = ?").bind(now, appId, id),
    ...(appId
      ? [
          env.DB.prepare("INSERT INTO rental_talk (app_id, user_id, text, created_at) VALUES (?, ?, ?, ?)").bind(appId, me.id, text, now),
          env.DB.prepare("UPDATE rental_apps SET updated_at = ? WHERE id = ?").bind(now, appId),
        ]
      : []),
  ]);
  await notifyManagers(env, `반납 신청: ${item.renter} · ${itemLabel(item)}${when ? ` · ${when}` : ""}`, me.id);
  return json({ ok: true, returnReqAt: now, returnAppId: appId });
};
