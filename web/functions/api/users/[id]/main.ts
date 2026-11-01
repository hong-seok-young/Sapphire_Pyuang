// POST /api/users/:id/main -> 이 캐릭터를 본캐로 (부캐 묶기, 제작자 요청 2026-11-01: 키우다 보면 주력 캐릭터가 바뀐다).
// 본인('내 정보'의 내 캐릭터) 또는 그 사람을 다룰 수 있는 관리자('길드원 관리'). 비밀번호는 그대로 이어받고
// 로그인 아이디만 새 본캐로 바뀐다. 캐릭터(랭킹, 거래, 글)와 지금 로그인은 그대로다
import { FORBIDDEN, NEED_LOGIN, canManage, currentUser, json, paramId, samePerson } from "../../../../server/auth";
import type { Env, Role } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";

interface Row {
  id: string;
  role: Role;
  main_id: string | null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const user = await env.DB.prepare("SELECT id, role, main_id FROM users WHERE id = ?").bind(paramId(params)).first<Row>();
  if (!user) return json({ error: "없는 아이디예요" }, 404);
  if (!user.main_id) return json({ error: "이미 본캐예요" }, 400);
  const main = await env.DB.prepare("SELECT id, role, main_id FROM users WHERE id = ?").bind(user.main_id).first<Row>();
  if (!main) return json({ error: "본캐를 찾지 못했어요" }, 404);
  if (!samePerson(me, user) && !(canManage(me.role, main.role) && canManage(me.role, user.role))) return FORBIDDEN();
  await env.DB.batch([
    // 새 본캐가 비밀번호(와 '바꿔야 함')를 이어받는다: 로그인 아이디만 바뀐다
    env.DB.prepare(
      "UPDATE users SET main_id = NULL, pw_hash = (SELECT pw_hash FROM users WHERE id = ?1), pw_salt = (SELECT pw_salt FROM users WHERE id = ?1), " +
        "pw_iter = (SELECT pw_iter FROM users WHERE id = ?1), must_change = (SELECT must_change FROM users WHERE id = ?1) WHERE id = ?2",
    ).bind(main.id, user.id),
    env.DB.prepare("UPDATE users SET main_id = ?1 WHERE main_id = ?2 OR id = ?2").bind(user.id, main.id),
    env.DB.prepare("UPDATE signup_requests SET owner = ? WHERE owner = ?").bind(user.id, main.id),
  ]);
  if (!samePerson(me, user)) {
    await notify(env, [user.id], "account", `본캐가 ${user.id}(으)로 바뀌었어요. 이제 ${user.id} 아이디로 로그인해요 (비밀번호는 그대로)`, "#/me", me.id);
  }
  return json({ ok: true, main: user.id });
};
