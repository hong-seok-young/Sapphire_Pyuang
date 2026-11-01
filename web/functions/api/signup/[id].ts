// POST /api/signup/:id { action: "approve" | "reject" } -> 아이디 생성 요청 승낙(길드원 계정을 그 비밀번호로 만든다) / 거절 (오피서 이상)
// 캐릭터 추가 요청(owner 가 있음)이면 그 사람의 부캐로 만든다 (본캐 비밀번호로 로그인, 부캐 묶기)
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, paramId, readJson } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import type { Env } from "../../../server/auth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (RANK[me.role] < 1) return FORBIDDEN();
  const id = paramId(params);
  const { action } = await readJson<{ action: unknown }>(request);
  const req = await env.DB.prepare("SELECT * FROM signup_requests WHERE id = ?")
    .bind(id)
    .first<{ id: string; pw_hash: string; pw_salt: string; pw_iter: number; owner: string | null }>();
  if (!req) return json({ error: "이미 처리한 요청이에요" }, 404);
  if (action === "reject") {
    await env.DB.prepare("DELETE FROM signup_requests WHERE id = ?").bind(id).run();
    if (req.owner) await notify(env, [req.owner], "account", `캐릭터 ${id} 추가 요청이 거절됐어요`, "#/me", me.id);
    return json({ ok: true });
  }
  if (action !== "approve") return json({ error: "승낙이나 거절을 골라 주세요" }, 400);
  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(id).first();
  if (exists) {
    await env.DB.prepare("DELETE FROM signup_requests WHERE id = ?").bind(id).run();
    return json({ error: "이미 있는 아이디예요 (요청은 지웠어요)" }, 409);
  }
  if (req.owner) {
    // 캐릭터 추가: 요청한 사람의 본캐에 묶는다 (그사이 본캐가 다른 본캐에 묶였으면 그 본캐로). 직업, 레벨, 길드는 처음 바꿔 들어가면 정한다
    const owner = await env.DB.prepare("SELECT COALESCE(main_id, id) AS id FROM users WHERE id = ?").bind(req.owner).first<{ id: string }>();
    if (!owner) {
      await env.DB.prepare("DELETE FROM signup_requests WHERE id = ?").bind(id).run();
      return json({ error: "요청한 계정이 없어졌어요 (요청은 지웠어요)" }, 409);
    }
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, role, pw_hash, pw_salt, pw_iter, must_change, created_at, created_by, main_id) VALUES (?, 'member', ?, ?, ?, 0, ?, ?, ?)",
      ).bind(id, req.pw_hash, req.pw_salt, req.pw_iter, Date.now(), me.id, owner.id),
      env.DB.prepare("DELETE FROM signup_requests WHERE id = ?").bind(id),
    ]);
    await notify(env, [owner.id], "account", `캐릭터 ${id} 추가를 승낙했어요. 👤 를 눌러 바꿔요`, "#/me", me.id);
    return json({ ok: true, id }, 201);
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
