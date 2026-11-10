// PUT /api/fit/draft { data } -> 하는 중인 운동을 그대로 둔다 (새로 고치거나 다른 폰에서 열어도 이어서, 화면이 바뀔 때마다 모아서 보낸다).
// DELETE /api/fit/draft -> 운동 취소. 자주 와서 사용 기록에는 남기지 않는다 (functions/api/_middleware.ts). server/fit.ts
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { MAX_DRAFT, canUseFit } from "../../../server/fit";

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseFit(me)) return FORBIDDEN();
  const b = await readJson<{ data: unknown }>(request);
  const data = b.data && typeof b.data === "object" && !Array.isArray(b.data) ? JSON.stringify(b.data) : null;
  if (!data) return json({ error: "운동 모양이 맞지 않아요" }, 400);
  if (data.length > MAX_DRAFT) return json({ error: "운동이 너무 길어요" }, 413);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO fit_drafts (user_id, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (user_id) DO UPDATE SET data = ?2, updated_at = ?3")
    .bind(me.id, data, now)
    .run();
  return json({ ok: true, at: now });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseFit(me)) return FORBIDDEN();
  await env.DB.prepare("DELETE FROM fit_drafts WHERE user_id = ?").bind(me.id).run();
  return json({ ok: true });
};
