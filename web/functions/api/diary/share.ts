// POST /api/diary/share { settle } -> { token, url }: 그 정산의 정산서 링크 (로그인 없이 /p/<token>, functions/p/[[path]].ts). 정산마다 하나, 있으면 그대로
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { NOPE, canUseDiary } from "../../../server/diary";

const token = () => {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  const b = (await request.json().catch(() => ({}))) as { settle?: unknown };
  const id = Number(b.settle);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "정산을 골라 주세요" }, 400);
  const s = await env.DB.prepare("SELECT id FROM diary_settles WHERE id = ?").bind(id).first();
  if (!s) return json({ error: "없는 정산이에요" }, 404);
  await env.DB.prepare("INSERT OR IGNORE INTO diary_shares (token, settle_id, created_by, created_at) VALUES (?, ?, ?, ?)")
    .bind(token(), id, me.id, Date.now())
    .run();
  const row = await env.DB.prepare("SELECT token FROM diary_shares WHERE settle_id = ?").bind(id).first<{ token: string }>();
  return json({ token: row!.token, url: new URL("/p/" + row!.token, request.url).toString() });
};
