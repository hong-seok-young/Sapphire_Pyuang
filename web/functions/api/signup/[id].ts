// POST /api/signup/:id { action: "approve" | "reject" } -> 아이디 생성 요청 승낙(길드원 계정을 그 비밀번호로 만든다) / 거절 (오피서 이상)
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, paramId, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (RANK[me.role] < 1) return FORBIDDEN();
  const id = paramId(params);
  const { action } = await readJson<{ action: unknown }>(request);
  const req = await env.DB.prepare("SELECT * FROM signup_requests WHERE id = ?")
    .bind(id)
    .first<{ id: string; pw_hash: string; pw_salt: string; pw_iter: number }>();
  if (!req) return json({ error: "이미 처리한 요청이에요" }, 404);
  if (action === "reject") {
    await env.DB.prepare("DELETE FROM signup_requests WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  if (action !== "approve") return json({ error: "승낙이나 거절을 골라 주세요" }, 400);
  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(id).first();
  if (exists) {
    await env.DB.prepare("DELETE FROM signup_requests WHERE id = ?").bind(id).run();
    return json({ error: "이미 있는 아이디예요 (요청은 지웠어요)" }, 409);
  }
  // 본인이 정한 비밀번호라 처음 로그인 때 바꾸게 하지 않는다. 직업, 레벨, 길드는 처음 들어오면 정한다
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, role, pw_hash, pw_salt, pw_iter, must_change, created_at, created_by) VALUES (?, 'member', ?, ?, ?, 0, ?, ?)",
    ).bind(id, req.pw_hash, req.pw_salt, req.pw_iter, Date.now(), me.id),
    env.DB.prepare("DELETE FROM signup_requests WHERE id = ?").bind(id),
  ]);
  return json({ ok: true, id }, 201);
};
