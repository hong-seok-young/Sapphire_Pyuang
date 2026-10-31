// POST /api/dev/switch { to: "테스트1" | "테스트2" | "back" } -> 앱개발자 전용 테스트 계정 전환 (제작자 요청:
// 혼자서 상대방 쪽 화면, 알림, 거래/의뢰 상호작용을 시험하려고). 실제 길드원 계정으로는 바꿀 수 없다.
// 전환하면 sid 는 테스트 계정 세션, sid_dev 에 앱개발자 세션을 넣어 두고, back 으로 되돌린다.
import { FORBIDDEN, NEED_LOGIN, createSession, currentUser, json, meInfo, passwordFields, readCookie, readJson, sessionCookie, userOfToken } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { TEST_IDS } from "../../../server/auth";

const DEV_COOKIE = "sid_dev";
const devCookie = (token: string, maxAge: number) => `${DEV_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { to } = await readJson<{ to: unknown }>(request);

  if (to === "back") {
    const devToken = readCookie(request, DEV_COOKIE);
    const dev = devToken ? await userOfToken(env, devToken) : null;
    if (!devToken || !dev || dev.role !== "developer") return FORBIDDEN();
    const res = json(await meInfo(env, dev));
    res.headers.append("set-cookie", sessionCookie(devToken));
    res.headers.append("set-cookie", devCookie("", 0));
    return res;
  }

  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (me.role !== "developer" || typeof to !== "string" || !TEST_IDS.includes(to)) return FORBIDDEN();
  const myToken = readCookie(request, "sid");
  if (!myToken) return NEED_LOGIN();

  // 테스트 계정이 없으면 만든다 (길드원, 비밀번호는 아무도 모르는 값, 직업과 레벨도 채워서 바로 쓸 수 있게)
  const pw = await passwordFields(crypto.randomUUID());
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, role, pw_hash, pw_salt, pw_iter, must_change, created_at, created_by) VALUES (?, 'member', ?, ?, ?, 0, ?, ?)",
    ).bind(to, pw.pw_hash, pw.pw_salt, pw.pw_iter, now, me.id),
    env.DB.prepare(
      "INSERT OR IGNORE INTO profiles (user_id, job, level, prev_level, level_at, updated_by, exp, guild) VALUES (?, 'warrior', 1, NULL, ?, ?, NULL, 'main')",
    ).bind(to, now, me.id),
  ]);
  const user = await env.DB.prepare("SELECT id, role, must_change FROM users WHERE id = ?").bind(to).first<{ id: string; role: "member"; must_change: number }>();
  if (!user) return json({ error: "테스트 계정을 만들지 못했어요" }, 500);
  const token = await createSession(env, user.id);
  const res = json(await meInfo(env, user));
  res.headers.append("set-cookie", sessionCookie(token));
  res.headers.append("set-cookie", devCookie(myToken, 86_400));
  return res;
};
