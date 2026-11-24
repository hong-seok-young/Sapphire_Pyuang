// PUT /api/diary/rates { level, per_pct?, per_hour?, test_pct? } -> 그 레벨 단가 (모두 비우면 지운다)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { NOPE, canUseDiary } from "../../../server/diary";

const amount = (v: unknown, hi: number) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= hi ? n : undefined;
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDiary(env, me)) return NOPE();
  const b = await readJson<Record<string, unknown>>(request);
  const level = Number(b.level);
  const per_pct = amount(b.per_pct, 10_000_000);
  const per_hour = amount(b.per_hour, 10_000_000);
  const test_pct = amount(b.test_pct, 100);
  if (!Number.isInteger(level) || level < 1 || level > 99 || [per_pct, per_hour, test_pct].includes(undefined)) return json({ error: "단가가 맞지 않아요" }, 400);
  if (per_pct === null && per_hour === null && test_pct === null) {
    await env.DB.prepare("DELETE FROM diary_rates WHERE level = ?").bind(level).run();
    return json({ ok: true });
  }
  await env.DB.prepare(
    "INSERT INTO diary_rates (level, per_pct, per_hour, test_pct, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (level) DO UPDATE SET per_pct = excluded.per_pct, per_hour = excluded.per_hour, test_pct = excluded.test_pct, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
  )
    .bind(level, per_pct ?? null, per_hour ?? null, test_pct ?? null, me.id, Date.now())
    .run();
  return json({ ok: true });
};
