// POST /api/bday/resume { key } -> { combo } : 끊긴 콤보 이어서 하기 단추를 눌렀다 (제작자 2026-11-08 '쿨쿨 쿠루미 11700 에서 이어서').
// 한 번만 (used_at). 이어서 시작한 콤보가 끝나면 화면이 보통 콤보처럼 POST /api/bday 로 남긴다
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { BDAYS } from "../../../server/birthday";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ key: unknown }>(request);
  const key = typeof b.key === "string" ? b.key : "";
  const d = BDAYS[key];
  if (!d) return json({ error: "없는 생일이에요" }, 404);
  const now = Date.now();
  if (now >= d.end) return json({ error: "생일이 지났어요" }, 409);
  const row = await env.DB.prepare("SELECT combo FROM bday_resume WHERE bday = ? AND user_id = ? AND used_at IS NULL").bind(key, me.id).first<{ combo: number }>();
  if (!row) return json({ error: "이어서 할 콤보가 없어요" }, 409);
  await env.DB.prepare("UPDATE bday_resume SET used_at = ? WHERE bday = ? AND user_id = ? AND used_at IS NULL").bind(now, key, me.id).run();
  return json({ combo: row.combo });
};
