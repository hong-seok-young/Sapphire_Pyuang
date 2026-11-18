// POST /api/fix/:id/shots (본문: 그림, content-type) -> 접수에 스샷 한 장 (쓴 사람, 접수하고 1시간 안, 3장까지)
// 길드원이 갤러리에서 직접 고른 그림만 받는다 (앱은 화면을 찍지 않는다, CLAUDE.md 게임 안전 규칙)
import { NEED_LOGIN, currentUser, json } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { SHOTS_MAX, SHOT_MAX_BYTES, loadFix, ownsFix } from "../../../../server/fix";

const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const r = await loadFix(env, Number(params.id));
  if (!r || !ownsFix(me, r.user_id)) return json({ error: "없는 접수예요" }, 404);
  if (Date.now() - r.created_at > 3_600_000) return json({ error: "스샷은 접수하고 1시간 안에 올려 주세요" }, 400);
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!TYPES.includes(type)) return json({ error: "그림만 올릴 수 있어요" }, 400);
  if (Number(request.headers.get("content-length") ?? 0) > SHOT_MAX_BYTES) return json({ error: "그림이 너무 커요" }, 413);
  const data = new Uint8Array(await request.arrayBuffer());
  if (!data.length || data.length > SHOT_MAX_BYTES) return json({ error: "그림이 너무 커요" }, 413);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM fix_shots WHERE report_id = ?").bind(r.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= SHOTS_MAX) return json({ error: `스샷은 ${SHOTS_MAX}장까지예요` }, 400);
  const row = await env.DB.prepare("INSERT INTO fix_shots (report_id, type, size, data, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(r.id, type, data.length, data, Date.now())
    .first<{ id: number }>();
  return json({ id: row?.id }, 201);
};
