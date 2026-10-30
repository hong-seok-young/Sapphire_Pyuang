// PUT    /api/avatar (본문: PNG) -> 내 캐릭터 그림 올리기 (랭킹 시상대에 선다). { avatar: 올린 때 }
// DELETE /api/avatar             -> 내 캐릭터 그림 지우기
// 그림은 '내 정보'에서 길드원이 직접 고른 자기 캐릭터 스샷을 화면에서 잘라 만든다 (앱은 화면을 찍지 않는다)
import { AVATAR_MAX_BYTES, NEED_LOGIN, checkPng, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (Number(request.headers.get("content-length") ?? 0) > AVATAR_MAX_BYTES) return json({ error: "그림이 너무 커요" }, 413);
  const png = new Uint8Array(await request.arrayBuffer());
  const bad = checkPng(png);
  if (bad) return json({ error: bad }, 400);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO avatars (user_id, updated_at, updated_by, png) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET " +
      "updated_at = excluded.updated_at, updated_by = excluded.updated_by, png = excluded.png",
  )
    .bind(me.id, now, me.id, png)
    .run();
  return json({ avatar: now });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  await env.DB.prepare("DELETE FROM avatars WHERE user_id = ?").bind(me.id).run();
  return json({ ok: true });
};
