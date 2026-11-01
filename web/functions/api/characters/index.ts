// POST /api/characters { id } -> 내 캐릭터 추가 요청 ('내 정보'의 캐릭터 추가, 부캐 묶기). 길드마스터·오피서가 '길드원 관리'에서 승낙하면
// 내 부캐가 된다 (본캐 아이디와 비밀번호로 로그인하고 👤 에서 바꾼다). 요청은 아이디 생성 요청과 같은 표(signup_requests)에 owner 를 붙여 둔다
import { NEED_LOGIN, currentUser, json, passwordFields, readJson, validId } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { notify } from "../../../server/alerts";

/** 한 사람이 한꺼번에 기다릴 수 있는 캐릭터 추가 요청 */
const MAX_PENDING = 5;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const owner = me.owner ?? me.id;
  const body = await readJson<{ id: unknown }>(request);
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!validId(id)) return json({ error: "닉네임은 한글, 영문, 숫자로 20자까지 써 주세요" }, 400);
  const [user, pending, mine] = await env.DB.batch([
    env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(id),
    env.DB.prepare("SELECT 1 FROM signup_requests WHERE id = ?").bind(id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM signup_requests WHERE owner = ?").bind(owner),
  ]);
  if (user.results.length) return json({ error: "이미 있는 아이디예요. 내 캐릭터면 운영진에게 계정 통합을 부탁하세요" }, 409);
  if (pending.results.length) return json({ error: "이미 요청한 닉네임이에요" }, 409);
  if (((mine.results[0] as { n: number } | undefined)?.n ?? 0) >= MAX_PENDING) return json({ error: "승낙을 기다리는 요청이 많아요" }, 429);
  // 부캐는 본캐 비밀번호로 들어오므로 자기 비밀번호가 없다 (아무도 모르는 값)
  const pw = await passwordFields(crypto.randomUUID());
  await env.DB.prepare("INSERT INTO signup_requests (id, pw_hash, pw_salt, pw_iter, created_at, owner) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, pw.pw_hash, pw.pw_salt, pw.pw_iter, Date.now(), owner)
    .run();
  const { results } = await env.DB.prepare("SELECT DISTINCT COALESCE(main_id, id) AS id FROM users WHERE role IN ('developer', 'master', 'officer')").all<{ id: string }>();
  await notify(env, results.map((r) => r.id), "account", `${owner} 님이 캐릭터 ${id} 추가를 요청했어요`, "#/admin", me.id);
  return json({ ok: true, id }, 201);
};
