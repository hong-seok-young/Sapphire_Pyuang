// PUT /api/gcoin/round { from: "2026-11-11", to: "2026-11-17" } -> 주간 목표 판의 기간 정하기 (담당자, 제작자 2026-11-10 '며칠 00시부터 며칠 24시까지 이벤트 기간 설정').
// 한국 시간 from 날 0시 ~ to 날 24시. 진행 중이거나 시작 전인 판(targetRound)을 고치고, 끝난 뒤 다음 판을 안 정했으면 새 판을 만든다.
// 오픈(11/11 11:00) 전으로는 시작하지 않는다. 처음 정할 때 지금까지의 기본 판도 적어 둔다 (끝난 판 결과가 그대로 보이게)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { GCOIN_OPEN_AT, canManageGcoin, canUseGcoin } from "../../../server/gcoin";
import { currentRound, readRounds, targetRound } from "../../../server/gcrace";

const DAY = 86_400_000;
const KST = 9 * 3600_000;
/** "2026-11-11" -> 그날 한국 시간 0시 */
function dayMs(v: unknown): number | null {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - KST;
  return Number.isFinite(t) ? t : null;
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseGcoin(me) || !canManageGcoin(me)) return FORBIDDEN();
  const b = await readJson<{ from: unknown; to: unknown }>(request);
  const from = dayMs(b.from);
  const to = dayMs(b.to);
  if (from === null || to === null) return json({ error: "기간이 맞지 않아요" }, 400);
  const start = Math.max(from, GCOIN_OPEN_AT);
  const end = to + DAY;
  const now = Date.now();
  if (end <= start) return json({ error: "끝나는 날이 시작하는 날보다 앞이에요" }, 400);
  if (end - start > 62 * DAY) return json({ error: "기간은 두 달까지예요" }, 400);
  if (end <= now) return json({ error: "이미 지난 기간이에요" }, 400);

  const rounds = await readRounds(env);
  const stmts: D1PreparedStatement[] = [];
  // 처음 정하면 지금(또는 마지막) 기본 판을 적어 둔다
  const cur = await currentRound(env, now, rounds);
  const list = rounds ?? [cur];
  if (!rounds) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO gc_rounds (id, start, end_at, set_at, set_by) VALUES (?, ?, ?, ?, NULL)").bind(cur.id, cur.start, cur.end, now));
  const target = await targetRound(env, now, rounds);
  // 고치는 판: 진행 중이거나 시작 전인 판. 기본 판의 다음 판(아직 표에 없음)이나 다음 판 미정이면 새 판
  const editing = target && list.some((r) => r.id === target.id) ? target : null;
  if (editing && editing.start <= now && start !== editing.start && start > now)
    return json({ error: "진행 중인 판은 시작하는 날을 오늘 뒤로 옮길 수 없어요" }, 400);
  const id = editing?.id ?? start;
  if (!editing && start < now - DAY) return json({ error: "다음 판은 오늘이나 그 뒤에 시작해 주세요" }, 400);
  // 다른 판과 겹치지 않게
  for (const r of list) if (r.id !== id && start < r.end && r.start < end) return json({ error: "다른 판 기간과 겹쳐요" }, 400);
  stmts.push(
    env.DB.prepare(
      "INSERT INTO gc_rounds (id, start, end_at, set_at, set_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET start = excluded.start, end_at = excluded.end_at, set_at = excluded.set_at, set_by = excluded.set_by",
    ).bind(id, start, end, now, me.id),
  );
  await env.DB.batch(stmts);
  return json({ ok: true });
};
