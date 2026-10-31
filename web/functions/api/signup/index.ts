// POST /api/signup { id, password } -> 아이디 생성 요청 (로그인 전, 누구나). 길드마스터·오피서가 '길드원 관리'에서 승낙하면 그 비밀번호로 들어온다
// GET  /api/signup -> 승낙을 기다리는 요청 목록 (오피서 이상)
// 제작자 요청 2026-11-01: 매번 운영진이 아이디를 만들어 알려 주기 귀찮으니, 로그인 화면에서 본인이 닉네임과 비밀번호를 넣어 요청하고
// 운영진이 확인해 승낙하게. 비밀번호는 원문을 두지 않고 해시만 둔다 (승낙하면 그대로 계정 비밀번호가 된다, 바꾸라고 하지 않는다).
import { NEED_LOGIN, FORBIDDEN, RANK, currentUser, json, passwordFields, readJson, validId, validPassword } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { notify } from "../../../server/alerts";

/** 한꺼번에 기다릴 수 있는 요청 수 (마구 넣는 것을 막는다) */
const MAX_PENDING = 50;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await readJson<{ id: unknown; password: unknown }>(request);
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!validId(id)) return json({ error: "닉네임은 한글, 영문, 숫자로 20자까지 써 주세요" }, 400);
  if (!validPassword(body.password)) return json({ error: "비밀번호는 6자 이상으로 해 주세요" }, 400);
  const [user, pending, count] = await env.DB.batch([
    env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(id),
    env.DB.prepare("SELECT 1 FROM signup_requests WHERE id = ?").bind(id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM signup_requests"),
  ]);
  if (user.results.length) return json({ error: "이미 있는 아이디예요. 비밀번호를 잊었으면 운영진에게 초기화를 부탁하세요" }, 409);
  if (pending.results.length) return json({ error: "이미 요청한 닉네임이에요. 운영진이 승낙하면 로그인할 수 있어요" }, 409);
  if (((count.results[0] as { n: number } | undefined)?.n ?? 0) >= MAX_PENDING) return json({ error: "요청이 많이 밀려 있어요. 운영진에게 알려 주세요" }, 429);
  const pw = await passwordFields(body.password as string);
  await env.DB.prepare("INSERT INTO signup_requests (id, pw_hash, pw_salt, pw_iter, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, pw.pw_hash, pw.pw_salt, pw.pw_iter, Date.now())
    .run();
  // 길드마스터와 오피서에게 (앱개발자도 관리하므로 같이)
  const { results } = await env.DB.prepare("SELECT id FROM users WHERE role IN ('developer', 'master', 'officer')").all<{ id: string }>();
  await notify(env, results.map((r) => r.id), "account", `${id} 님이 아이디 생성을 요청했어요`, "#/admin", id);
  return json({ ok: true }, 201);
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (RANK[me.role] < 1) return FORBIDDEN();
  const { results } = await env.DB.prepare("SELECT id, created_at FROM signup_requests ORDER BY created_at").all<{ id: string; created_at: number }>();
  return json(results.map((r) => ({ id: r.id, createdAt: r.created_at })));
};
