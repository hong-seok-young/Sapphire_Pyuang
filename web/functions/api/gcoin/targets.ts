// PUT /api/gcoin/targets { userId, target } -> 이번 주간 판(쉬는 주면 다음 판)의 목표 레벨 정하기 (담당자: 오피서 이상, 김다혜 2026-11-09 '2주간의 목표 레벨은 담당자가 정해 주고').
// target 이 null 이면 뺀다. 2군 본캐에게만, 목표는 지금 레벨보다 높게. 정할 때 레벨을 시작 레벨로 적는다 (달성률의 0%)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canManageGcoin, canUseGcoin, int, isMember } from "../../../server/gcoin";
import { targetRound } from "../../../server/gcrace";

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseGcoin(me) || !canManageGcoin(me.role)) return FORBIDDEN();
  const b = await readJson<{ userId: unknown; target: unknown }>(request);
  const userId = typeof b.userId === "string" ? b.userId : "";
  if (!userId || !(await isMember(env, userId))) return json({ error: "2군 본캐가 아니에요" }, 400);
  const round = targetRound();
  if (b.target === null) {
    await env.DB.prepare("DELETE FROM gc_targets WHERE round = ? AND user_id = ?").bind(round, userId).run();
    return json({ ok: true });
  }
  const p = await env.DB.prepare("SELECT level FROM profiles WHERE user_id = ?").bind(userId).first<{ level: number }>();
  if (!p) return json({ error: "레벨을 아직 안 적은 사람이에요" }, 400);
  const target = int(b.target, 2, 99);
  if (target === null) return json({ error: "목표 레벨이 맞지 않아요" }, 400);
  // 이미 정한 목표를 고치면 시작 레벨은 그대로 (달성률이 튀지 않게), 처음이면 지금 레벨
  const had = await env.DB.prepare("SELECT from_level FROM gc_targets WHERE round = ? AND user_id = ?").bind(round, userId).first<{ from_level: number }>();
  const from = had?.from_level ?? p.level;
  if (target <= from) return json({ error: `목표는 Lv.${from} 보다 높게 정해 주세요` }, 400);
  await env.DB.prepare(
    "INSERT INTO gc_targets (round, user_id, from_level, target, set_at, set_by) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT (round, user_id) DO UPDATE SET target = excluded.target, set_at = excluded.set_at, set_by = excluded.set_by",
  )
    .bind(round, userId, from, target, Date.now(), me.id)
    .run();
  return json({ ok: true });
};
