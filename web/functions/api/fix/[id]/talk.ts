// POST /api/fix/:id/talk { text } -> 접수에 대화 한 줄 (쓴 사람과 운영진, 제작자 2026-11-18 '접수자와 길마 개발자 오피서가 대화, 그 오류에 대해 상호 확인')
// 쓴 사람이 쓰면 운영진에게, 운영진이 쓰면 쓴 사람에게 알림 (fix)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";
import { canSeeFix, clip, fixStaff, loadFix, ownsFix } from "../../../../server/fix";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const r = await loadFix(env, Number(params.id));
  const owner = !!r && ownsFix(me, r.user_id);
  if (!r || !(owner || canSeeFix(me))) return json({ error: "없는 접수예요" }, 404);
  const { text } = await readJson<{ text: unknown }>(request);
  const t = typeof text === "string" ? text.trim().slice(0, 500) : "";
  if (!t) return json({ error: "글을 적어 주세요" }, 400);
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM fix_talk WHERE user_id = ? AND created_at > ?").bind(me.id, now - 60_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 10) return json({ error: "조금 뒤에 다시 보내 주세요" }, 429);
  const [row] = await env.DB.batch([
    env.DB.prepare("INSERT INTO fix_talk (report_id, user_id, text, created_at) VALUES (?, ?, ?, ?) RETURNING id, user_id, text, created_at").bind(r.id, me.id, t, now),
    env.DB.prepare("UPDATE fix_reports SET talk_at = ? WHERE id = ?").bind(now, r.id),
  ]);
  const mineIds = me.chars ?? [me.id];
  if (owner) {
    const staff = (await fixStaff(env)).filter((u) => !mineIds.includes(u));
    await notify(env, staff, "fix", `[개선 접수 대화] ${r.menu} · ${me.id}: ${clip(t)}`, `#/gaps?r=${r.id}`, me.id);
  } else {
    await notify(env, [r.user_id], "fix", `[개선 접수 대화] ${me.id}: ${clip(t)}`, `#/fix?r=${r.id}`, me.id);
  }
  return json({ talk: { ...(row.results[0] as object), role: me.role } }, 201);
};
