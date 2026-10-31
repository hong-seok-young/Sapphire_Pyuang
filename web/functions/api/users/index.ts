// GET  /api/users              -> 계정 목록 (오피서 이상). 직업, 레벨, 캐릭터 그림을 올린 때
// POST /api/users { id, role, password? } -> 계정 만들기. 처음 비밀번호(정한 것이나 임시)를 한 번만 돌려준다
import {
  FORBIDDEN, NEED_LOGIN, RANK, canManage, currentUser, firstPassword, isRole, json, passwordFields, readJson, validId,
} from "../../../server/auth";
import type { Env, Guild, Job, Role } from "../../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (RANK[me.role] < 1) return FORBIDDEN();
  const { results } = await env.DB.prepare(
    "SELECT u.id AS id, u.role AS role, u.must_change AS must_change, u.created_at AS created_at, u.created_by AS created_by, " +
      "p.job AS job, p.level AS level, p.guild AS guild, a.updated_at AS avatar FROM users u LEFT JOIN profiles p ON p.user_id = u.id " +
      "LEFT JOIN avatars a ON a.user_id = u.id",
  ).all<{
    id: string; role: Role; must_change: number; created_at: number; created_by: string | null; job: Job | null; level: number | null;
    guild: Guild | null; avatar: number | null;
  }>();
  const users = results
    .map((u) => ({
      id: u.id, role: u.role, mustChange: u.must_change === 1, createdAt: u.created_at, createdBy: u.created_by,
      job: u.job, level: u.level, guild: u.guild, avatar: u.avatar,
    }))
    .sort((a, b) => RANK[b.role] - RANK[a.role] || a.id.localeCompare(b.id, "ko"));
  return json(users);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const body = await readJson<{ id: string; role: string; password: string }>(request);
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const role = body.role ?? "member";
  if (!validId(id)) return json({ error: "아이디는 한글, 영문, 숫자로 20자까지 써 주세요" }, 400);
  if (!isRole(role) || !canManage(me.role, role)) return FORBIDDEN();

  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(id).first();
  if (exists) return json({ error: "이미 있는 아이디예요" }, 409);

  const temp = firstPassword(body.password);
  if (temp === null) return json({ error: "처음 비밀번호는 6자 이상으로 해 주세요" }, 400);
  const pw = await passwordFields(temp);
  await env.DB.prepare(
    "INSERT INTO users (id, role, pw_hash, pw_salt, pw_iter, must_change, created_at, created_by) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
  )
    .bind(id, role, pw.pw_hash, pw.pw_salt, pw.pw_iter, Date.now(), me.id)
    .run();
  return json({ id, role, tempPassword: temp }, 201);
};
