// POST /api/login  { id, password } -> 로그인 쿠키와 내 정보 { id, role, mustChange, job, level, exp, avatar } (/api/me 와 같은 모양)
import { createSession, hashPassword, json, meInfo, readJson, sessionCookie, verifyPassword } from "../../server/auth";
import type { Env, UserRow } from "../../server/auth";

const DUMMY_SALT = new Uint8Array(16);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await readJson<{ id: string; password: string }>(request);
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!id || !password) return json({ error: "아이디와 비밀번호를 넣어 주세요" }, 400);

  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  if (!row) {
    await hashPassword(password, DUMMY_SALT) // 없는 아이디도 같은 시간이 걸리게
    return json({ error: "아이디나 비밀번호가 맞지 않아요" }, 401);
  }
  if (!(await verifyPassword(password, row))) return json({ error: "아이디나 비밀번호가 맞지 않아요" }, 401);

  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run(); // 끝난 세션 정리
  const token = await createSession(env, row.id);
  return json(await meInfo(env, row), 200, {
    "set-cookie": sessionCookie(token),
  });
};
