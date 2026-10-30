// POST /api/password  { current, next } -> 내 비밀번호 바꾸기 (임시 비밀번호도 여기서 바꾼다)
import { NEED_LOGIN, currentUser, json, passwordFields, readJson, validPassword, verifyPassword } from "../../server/auth";
import type { Env, UserRow } from "../../server/auth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const body = await readJson<{ current: string; next: string }>(request);
  if (!validPassword(body.next)) return json({ error: "새 비밀번호는 6자 이상으로 해 주세요" }, 400);

  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(me.id).first<UserRow>();
  if (!row || typeof body.current !== "string" || !(await verifyPassword(body.current, row))) {
    return json({ error: "지금 비밀번호가 맞지 않아요" }, 400);
  }
  if (body.next === body.current) return json({ error: "지금 비밀번호와 다른 비밀번호로 해 주세요" }, 400);
  const pw = await passwordFields(body.next);
  await env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, must_change = 0 WHERE id = ?")
    .bind(pw.pw_hash, pw.pw_salt, pw.pw_iter, me.id)
    .run();
  return json({ ok: true });
};
