// PUT /api/gcoin/targets { userId, target } -> 이번 주간 판(쉬는 주면 다음 판)의 목표 레벨 정하기 (담당자: 오피서 이상, 김다혜 2026-11-09 '2주간의 목표 레벨은 담당자가 정해 주고').
// target 이 null 이면 뺀다. 대상은 담당자 재량(1군·2군 상관없이), 목표는 지금 레벨보다 높게. 정할 때 레벨을 시작 레벨로 적는다 (달성률의 0%)
import { FORBIDDEN, NEED_LOGIN, TEST_IDS, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canManageGcoin, canUseGcoin, int } from "../../../server/gcoin";
import { targetRound } from "../../../server/gcrace";

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseGcoin(me) || !canManageGcoin(me)) return FORBIDDEN();
  const b = await readJson<{ userId: unknown; target: unknown; hide?: unknown }>(request);
  const userId = typeof b.userId === "string" ? b.userId : "";
  // 대상은 담당자 재량 (제작자 2026-11-10 '대상자 추가·제거 자유롭게, 1군·2군 상관없이'): 레벨을 적은 계정이면 누구나 (테스트 계정 빼고)
  if (!userId || TEST_IDS.includes(userId)) return json({ error: "없는 계정이에요" }, 400);
  // 2군 본캐는 목표 목록에 저절로 들어간다 (제작자 2026-11-10 '2군은 자동으로 명단에, 새로운 인원 추가될 때만'):
  // 담당자가 ✕·빼기로 뺀 사람은 gc_settings 'hide:<아이디>' 에 적어 다시 안 넣는다. 목표를 정하면 지운다
  const hideKey = `hide:${userId}`;
  const hide = () =>
    env.DB.prepare("INSERT INTO gc_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .bind(hideKey, Date.now())
      .run();
  if (b.hide === true) {
    await hide();
    return json({ ok: true });
  }
  // 판·레벨·정해 둔 목표를 한꺼번에 읽는다 (제작자 2026-11-10 '명단 넣고 빼는 것도 반응이 늦다')
  const [r, p, mine] = await Promise.all([
    targetRound(env),
    env.DB.prepare("SELECT level FROM profiles WHERE user_id = ?").bind(userId).first<{ level: number }>(),
    env.DB.prepare("SELECT round, from_level FROM gc_targets WHERE user_id = ?").bind(userId).all<{ round: number; from_level: number }>(),
  ]);
  if (!r) return json({ error: "다음 판 기간을 먼저 정해 주세요" }, 409);
  const round = r.id;
  if (b.target === null) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM gc_targets WHERE round = ? AND user_id = ?").bind(round, userId),
      env.DB.prepare("INSERT INTO gc_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(hideKey, Date.now()),
    ]);
    return json({ ok: true });
  }
  if (!p) return json({ error: "레벨을 아직 안 적은 사람이에요" }, 400);
  const target = int(b.target, 2, 99);
  if (target === null) return json({ error: "목표 레벨이 맞지 않아요" }, 400);
  // 이미 정한 목표를 고치면 시작 레벨은 그대로 (달성률이 튀지 않게), 처음이면 지금 레벨
  const had = mine.results.find((t) => t.round === round);
  const from = had?.from_level ?? p.level;
  if (target <= from) return json({ error: `목표는 Lv.${from} 보다 높게 정해 주세요` }, 400);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO gc_targets (round, user_id, from_level, target, set_at, set_by) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (round, user_id) DO UPDATE SET target = excluded.target, set_at = excluded.set_at, set_by = excluded.set_by",
    ).bind(round, userId, from, target, Date.now(), me.id),
    env.DB.prepare("DELETE FROM gc_settings WHERE key = ?").bind(hideKey),
  ]);
  return json({ ok: true });
};
