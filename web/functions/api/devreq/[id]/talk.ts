// GET /api/devreq/:id/talk -> { talk } : 요청마다 대화 (개발할 수 있는지 신청한 사람과 이야기한다)
// POST /api/devreq/:id/talk { text } -> 한 줄 (300자, 1분에 10개). 신청한 사람과 앱개발자에게 알림 (쓴 사람 빼고)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { canUseDevReq, shortOf, tell } from "../../../../server/devreq";
import type { DevReqRow } from "../../../../server/devreq";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDevReq(me)) return FORBIDDEN();
  const { results } = await env.DB.prepare("SELECT id, user_id, text, created_at FROM dev_request_talk WHERE req_id = ? ORDER BY id LIMIT 300")
    .bind(Number(params.id))
    .all();
  return json({ talk: results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDevReq(me)) return FORBIDDEN();
  const row = await env.DB.prepare("SELECT * FROM dev_requests WHERE id = ?").bind(Number(params.id)).first<DevReqRow>();
  if (!row) return json({ error: "없는 요청이에요" }, 404);
  const b = await readJson<{ text: unknown }>(request);
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text || text.length > 300) return json({ error: "300자 안으로 적어 주세요" }, 400);
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM dev_request_talk WHERE user_id = ? AND created_at > ?").bind(me.id, now - 60_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 10) return json({ error: "잠시 뒤에 써 주세요" }, 429);
  const r = await env.DB.prepare("INSERT INTO dev_request_talk (req_id, user_id, text, created_at) VALUES (?, ?, ?, ?) RETURNING id").bind(row.id, me.id, text, now).first<{ id: number }>();
  await tell(env, me, ["owner", "developer"], row, `개발 요청 대화 · ${me.id}: ${text.slice(0, 40)} (${shortOf(row.body)})`);
  return json({ id: r!.id }, 201);
};
