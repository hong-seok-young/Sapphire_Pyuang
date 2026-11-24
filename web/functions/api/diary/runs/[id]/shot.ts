// PUT /api/diary/runs/:id/shot?side=from|to (본문은 그림 그대로) -> 그 줄의 시작·끝 스샷 (있으면 바꾼다)
import { NEED_LOGIN, currentUser, json } from "../../../../../server/auth";
import type { Env } from "../../../../../server/auth";
import { NOPE, canUseDiary } from "../../../../../server/diary";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX = 1_500_000;

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  const side = new URL(request.url).searchParams.get("side");
  if (side !== "from" && side !== "to") return json({ error: "잘못된 요청이에요" }, 400);
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!TYPES.includes(type)) return json({ error: "그림만 올릴 수 있어요" }, 400);
  const id = Number(params.id);
  const run = await env.DB.prepare("SELECT settle_id FROM diary_runs WHERE id = ?").bind(id).first<{ settle_id: number | null }>();
  if (!run) return json({ error: "없는 기록이에요" }, 404);
  if (run.settle_id !== null) return json({ error: "정산한 기록이에요" }, 409);
  const data = new Uint8Array(await request.arrayBuffer());
  if (!data.length || data.length > MAX) return json({ error: "그림이 너무 커요" }, 413);
  const row = await env.DB.prepare(
    "INSERT INTO diary_shots (run_id, side, type, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (run_id, side) DO UPDATE SET type = excluded.type, size = excluded.size, data = excluded.data, created_at = excluded.created_at RETURNING id",
  )
    .bind(id, side, type, data.length, data, Date.now())
    .first<{ id: number }>();
  return json({ id: row?.id }, 201);
};
