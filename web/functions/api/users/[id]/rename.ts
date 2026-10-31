// POST /api/users/:id/rename { newId, fresh?, job?, level?, exp?, guild? } -> 닉네임 바꾸기 (제작자 요청: 키우는 캐릭터를 바꾸거나 사는 일이 있어서)
// 본인, 또는 그 사람을 다룰 수 있는 관리자(canManage). 아이디가 여러 표의 키라서 한 번에 모두 바꾼다. 로그인은 그대로 이어진다.
// fresh: 다른 캐릭터로 바꿨으면(본인만) 새 직업, 레벨로 프로필을 바꾸고 성장 기록을 그 상태부터 새로 시작한다 (산 캐릭터로 성장이 튀지 않게).
//        예전 캐릭터의 기록은 지우지 않고 level_log_archive 로 옮긴다 (제작자 요청 2026-11-01: 레벨과 경험치 추이는 평생 기록)
import { FORBIDDEN, NEED_LOGIN, canManage, currentUser, json, paramId, readJson, readProfile, validId } from "../../../../server/auth";
import type { Env, Role } from "../../../../server/auth";

/** 닉네임이 들어 있는 칸 (표, 칸) */
const ID_COLUMNS: [string, string][] = [
  ["users", "created_by"], ["sessions", "user_id"], ["chat_usage", "user_id"], ["profiles", "user_id"], ["profiles", "updated_by"],
  ["level_log", "user_id"], ["level_log_archive", "user_id"], ["avatars", "user_id"], ["avatars", "updated_by"], ["listings", "seller"], ["listing_wants", "user_id"],
  ["listing_bids", "user_id"], ["gold_offers", "owner"], ["gold_wants", "user_id"], ["requests", "owner"], ["requests", "accepter"],
  ["activity", "user_id"], ["alerts", "user_id"], ["alert_prefs", "user_id"], ["listing_talk", "user_id"], ["plat_orders", "user_id"],
  ["favorites", "user_id"], ["board_posts", "author"], ["board_comments", "user_id"], ["board_likes", "user_id"], ["board_views", "user_id"],
  ["chat_threads", "user_id"], ["chat_gaps", "user_id"], ["plat_wallets", "user_id"], ["layouts", "user_id"],
];

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = paramId(params);
  const user = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(id).first<{ id: string; role: Role }>();
  if (!user) return json({ error: "없는 아이디예요" }, 404);
  const self = user.id === me.id;
  if (!self && !canManage(me.role, user.role)) return FORBIDDEN();

  const body = await readJson<{ newId: unknown; fresh: unknown; job: unknown; level: unknown; exp: unknown; guild: unknown }>(request);
  const newId = typeof body.newId === "string" ? body.newId.trim() : body.newId;
  if (!validId(newId)) return json({ error: "닉네임은 한글, 영문, 숫자로 20자까지 써 주세요" }, 400);
  if (newId === user.id) return json({ error: "지금과 같은 닉네임이에요" }, 400);
  const profile = body.fresh === true ? readProfile(body) : null;
  if (body.fresh === true && (!self || !profile)) return json({ error: "새 캐릭터의 직업과 레벨을 골라 주세요" }, 400);
  const taken = await env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(newId).first();
  if (taken) return json({ error: "이미 있는 닉네임이에요" }, 409);

  const stmts = [
    env.DB.prepare("UPDATE users SET id = ? WHERE id = ?").bind(newId, user.id),
    ...ID_COLUMNS.map(([table, col]) => env.DB.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`).bind(newId, user.id)),
  ];
  if (profile) {
    const now = Date.now();
    const exp = profile.exp ?? null;
    stmts.push(
      env.DB.prepare(
        "INSERT INTO profiles (user_id, job, level, prev_level, level_at, updated_by, exp, guild) VALUES (?1, ?2, ?3, NULL, ?4, ?1, ?5, ?6) " +
          "ON CONFLICT (user_id) DO UPDATE SET job = ?2, level = ?3, prev_level = NULL, level_at = ?4, updated_by = ?1, exp = ?5, " +
          "guild = COALESCE(?6, guild)",
      ).bind(newId, profile.job, profile.level, now, exp, profile.guild ?? null),
      env.DB.prepare(
        "INSERT INTO level_log_archive (user_id, at, level, exp, archived_at, reason) SELECT user_id, at, level, exp, ?, 'character' FROM level_log WHERE user_id = ?",
      ).bind(now, newId),
      env.DB.prepare("DELETE FROM level_log WHERE user_id = ?").bind(newId),
      env.DB.prepare("INSERT INTO level_log (user_id, at, level, exp) VALUES (?, ?, ?, ?)").bind(newId, now, profile.level, exp),
    );
  }
  await env.DB.batch(stmts);
  return json({ id: newId, fresh: !!profile });
};
