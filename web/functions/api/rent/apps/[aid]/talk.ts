// POST /api/rent/apps/:aid/talk { text } -> 신청서 대화창에 한 줄 (제작자 요청 2026-11-02: 대여 신청이 들어오면 이야기할 창구)
// 신청한 사람(묶은 캐릭터 모두)과 운영진만 쓴다. 200자, 1분에 10개까지. 신청한 사람이 쓰면 운영진에게, 운영진이 쓰면 신청한 사람에게 알림
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../../server/auth";
import type { Env } from "../../../../../server/auth";
import { notify } from "../../../../../server/alerts";
import { canEnter, isManager, notifyManagers } from "../../../../../server/rental";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me)) return FORBIDDEN();
  const aid = Number(Array.isArray(params.aid) ? params.aid[0] : params.aid);
  const b = await readJson<{ text: unknown }>(request);
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text || text.length > 200) return json({ error: "200자 안으로 적어 주세요" }, 400);
  const app = await env.DB.prepare("SELECT a.id, a.user_id, COALESCE(u.main_id, u.id, a.user_id) AS owner FROM rental_apps a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ?")
    .bind(aid)
    .first<{ id: number; user_id: string; owner: string }>();
  if (!app) return json({ error: "없는 신청서예요" }, 404);
  const applicant = app.owner === (me.owner ?? me.id);
  if (!applicant && !isManager(me)) return FORBIDDEN();
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM rental_talk WHERE user_id = ? AND created_at > ?").bind(me.id, now - 60_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 10) return json({ error: "잠깐 뒤에 다시 써 주세요" }, 429);
  const r = await env.DB.batch([
    env.DB.prepare("INSERT INTO rental_talk (app_id, user_id, text, created_at) VALUES (?, ?, ?, ?)").bind(aid, me.id, text, now),
    env.DB.prepare("UPDATE rental_apps SET updated_at = ? WHERE id = ?").bind(now, aid),
  ]);
  if (applicant) await notifyManagers(env, `대여 대화 · ${me.id}: ${text}`, me.id);
  else await notify(env, [app.user_id], "rent", `대여 대화 · ${me.id}: ${text}`, "#/rent", me.id);
  return json({ id: r[0].meta.last_row_id, at: now });
};
