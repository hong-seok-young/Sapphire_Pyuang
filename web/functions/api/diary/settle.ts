// POST /api/diary/settle -> 정산: 아직 정산 안 한 줄 금액 합, 1000원 아래는 절삭 (이월 없음, 제작자 2026-11-25). 줄은 그 금액으로 굳는다
// DELETE /api/diary/settle -> 가장 최근 정산 취소 (줄이 다시 정산 전으로)
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { NOPE, UNIT, canUseDiary, readRates, valueOf } from "../../../server/diary";
import type { Run } from "../../../server/diary";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  const [open, rates] = await Promise.all([
    env.DB.prepare("SELECT id, lv_from, exp_from, lv_to, exp_to, rate FROM diary_runs WHERE settle_id IS NULL").all<Run>(),
    readRates(env),
  ]);
  if (!open.results.length) return json({ error: "정산할 기록이 없어요" }, 400);
  const vals = open.results.map((r) => ({ id: r.id, won: valueOf(r, rates) }));
  const missing = open.results.filter((_, i) => vals[i].won === null);
  if (missing.length) {
    const lv = [...new Set(missing.flatMap((r) => Array.from({ length: r.lv_to - r.lv_from + 1 }, (_, k) => r.lv_from + k)))];
    return json({ error: `단가가 없는 레벨이 있어요 (Lv.${lv.join(", ")})` }, 409);
  }
  const sum = vals.reduce((t, v) => t + (v.won ?? 0), 0);
  const carry_in = 0;
  const pay = Math.max(0, Math.floor(sum / UNIT) * UNIT);
  const carry_out = 0;
  const s = await env.DB.prepare(
    "INSERT INTO diary_settles (at, by_user, runs, sum, carry_in, pay, carry_out) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(Date.now(), me.id, vals.length, sum, carry_in, pay, carry_out)
    .first<{ id: number }>();
  // 한 쿼리로 (줄이 많아도 요청 하나의 D1 횟수 한도에 안 걸리게): { 줄 번호: 금액 }
  const map = JSON.stringify(Object.fromEntries(vals.map((v) => [String(v.id), v.won])));
  await env.DB.prepare(
    "UPDATE diary_runs SET settle_id = ?, won = (SELECT j.value FROM json_each(?) j WHERE j.key = CAST(diary_runs.id AS TEXT)) WHERE settle_id IS NULL AND id IN (SELECT CAST(key AS INTEGER) FROM json_each(?))",
  )
    .bind(s!.id, map, map)
    .run();
  return json({ ok: true, id: s?.id, pay, carry_out });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  const last = await env.DB.prepare("SELECT id FROM diary_settles ORDER BY id DESC LIMIT 1").first<{ id: number }>();
  if (!last) return json({ error: "취소할 정산이 없어요" }, 400);
  await env.DB.batch([
    env.DB.prepare("UPDATE diary_runs SET settle_id = NULL, won = NULL WHERE settle_id = ?").bind(last.id),
    env.DB.prepare("DELETE FROM diary_settles WHERE id = ?").bind(last.id),
    env.DB.prepare("DELETE FROM diary_shares WHERE settle_id = ?").bind(last.id),
  ]);
  return json({ ok: true });
};
