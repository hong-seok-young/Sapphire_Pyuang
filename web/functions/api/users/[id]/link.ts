// POST   /api/users/:id/link { with, main } -> 같은 사람의 두 계정을 하나로 묶기 (오피서 이상, 부캐 묶기)
// DELETE /api/users/:id/link                -> 부캐를 본캐에서 떼기 (따로 로그인하게 처음 비밀번호 123123, 다음 로그인 때 바꾼다)
// 제작자 요청 2026-11-01: 이 게임은 부캐가 많아서 한 사람이 캐릭터마다 아이디를 만들어 두었다. 운영진이 같은 사람의 아이디를 묶으면
// 그 사람은 본캐 아이디와 비밀번호로 로그인하고 👤 에서 캐릭터를 바꾼다. 캐릭터(랭킹, 거래, 글)는 그대로 따로 있다.
// 묶을 때 고른 본캐가 아닌 쪽(과 그 부캐들)은 로그인이 끝난다 (본캐 아이디로 다시 들어온다)
import {
  FORBIDDEN, NEED_LOGIN, canManage, currentUser, json, paramId, passwordFields, readJson, samePerson,
} from "../../../../server/auth";
import type { Env, Role, User } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";

/** 부캐를 뗄 때의 처음 비밀번호 (길드원 관리의 새 계정, 비밀번호 초기화와 같다) */
const FIRST_PASSWORD = "123123";

interface Row {
  id: string;
  role: Role;
  main_id: string | null;
}

const find = (env: Env, id: string) => env.DB.prepare("SELECT id, role, main_id FROM users WHERE id = ?").bind(id).first<Row>();
/** 이 계정을 묶거나 뗄 수 있는지: 내 캐릭터이거나 다룰 수 있는 역할 */
const mayTouch = (me: User, u: Row) => samePerson(me, u) || canManage(me.role, u.role);

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const body = await readJson<{ with: unknown; main: unknown }>(request);
  const a = await find(env, paramId(params));
  const b = typeof body.with === "string" ? await find(env, body.with) : null;
  if (!a || !b) return json({ error: "없는 아이디예요" }, 404);
  if (a.id === b.id) return json({ error: "다른 계정을 골라 주세요" }, 400);
  // 부캐는 본캐를 골라서 묶는다 (부캐끼리 이어지지 않게)
  if (a.main_id || b.main_id) return json({ error: "이미 다른 본캐에 묶인 부캐예요. 본캐 계정으로 묶어 주세요" }, 400);
  if (body.main !== a.id && body.main !== b.id) return json({ error: "본캐를 골라 주세요" }, 400);
  if (!mayTouch(me, a) || !mayTouch(me, b)) return FORBIDDEN();
  const main = body.main === a.id ? a : b;
  const sub = main === a ? b : a;
  await env.DB.batch([
    // 부캐가 되는 쪽(과 그 부캐들)의 로그인은 끝낸다: 이제 본캐 아이디와 비밀번호로 들어온다
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 OR user_id IN (SELECT id FROM users WHERE main_id = ?1)").bind(sub.id),
    env.DB.prepare("UPDATE users SET main_id = ?1 WHERE id = ?2 OR main_id = ?2").bind(main.id, sub.id),
    env.DB.prepare("UPDATE signup_requests SET owner = ? WHERE owner = ?").bind(main.id, sub.id),
  ]);
  await notify(env, [main.id], "account", `${sub.id} 캐릭터를 ${main.id} 계정에 묶었어요. 홈의 닉네임을 눌러 캐릭터를 바꿔요`, "#/me", me.id);
  return json({ ok: true, main: main.id, sub: sub.id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const user = await find(env, paramId(params));
  if (!user) return json({ error: "없는 아이디예요" }, 404);
  if (!user.main_id) return json({ error: "묶인 부캐가 아니에요" }, 400);
  if (!mayTouch(me, user)) return FORBIDDEN();
  const pw = await passwordFields(FIRST_PASSWORD);
  await env.DB.batch([
    // 본캐에서 이 캐릭터로 바꿔 들어와 있던 로그인은 끝낸다
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("UPDATE users SET main_id = NULL, pw_hash = ?, pw_salt = ?, pw_iter = ?, must_change = 1 WHERE id = ?")
      .bind(pw.pw_hash, pw.pw_salt, pw.pw_iter, user.id),
  ]);
  return json({ id: user.id, tempPassword: FIRST_PASSWORD });
};
