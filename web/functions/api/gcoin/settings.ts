// PUT /api/gcoin/settings { levels?: [{ minLevel, coin }], rank?: [1위 ~ 5위], cap?: { name, n } (n 낱개, 0 = 한도 없음) } -> 레벨업 코인 표와 주간 순위 보너스 바꾸기 (오피서 이상)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { MAX_CAP, canManageGcoin, canUseGcoin, capKey, int } from "../../../server/gcoin";

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseGcoin(me) || !canManageGcoin(me)) return FORBIDDEN();
  const b = await readJson<{ levels: unknown; rank: unknown; cap: unknown }>(request);
  const stmts: D1PreparedStatement[] = [];
  if (b.levels !== undefined) {
    if (!Array.isArray(b.levels) || !b.levels.length || b.levels.length > 60) return json({ error: "레벨 표가 맞지 않아요" }, 400);
    const seen = new Set<number>();
    const rows: [number, number][] = [];
    for (const r of b.levels as Record<string, unknown>[]) {
      const lv = int(r?.minLevel, 1, 99);
      const coin = int(r?.coin, 0, 10_000);
      if (lv === null || coin === null) return json({ error: "레벨이나 코인이 맞지 않아요" }, 400);
      if (seen.has(lv)) return json({ error: `Lv.${lv} 가 두 번 있어요` }, 400);
      seen.add(lv);
      rows.push([lv, coin]);
    }
    stmts.push(env.DB.prepare("DELETE FROM gc_levels"));
    for (const [lv, coin] of rows) stmts.push(env.DB.prepare("INSERT INTO gc_levels (min_level, coin) VALUES (?, ?)").bind(lv, coin));
  }
  if (b.rank !== undefined) {
    if (!Array.isArray(b.rank) || b.rank.length !== 5) return json({ error: "순위 보너스가 맞지 않아요" }, 400);
    for (const [i, v] of (b.rank as unknown[]).entries()) {
      const n = int(v, 0, 10_000);
      if (n === null) return json({ error: "순위 보너스가 맞지 않아요" }, 400);
      stmts.push(env.DB.prepare("INSERT INTO gc_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(`rank${i + 1}`, n));
    }
  }
  if (b.cap !== undefined) {
    const c = b.cap as { name?: unknown; n?: unknown } | null;
    const key = typeof c?.name === "string" ? capKey(c.name) : "";
    const n = int(c?.n, 0, MAX_CAP);
    if (!key || key.length > 40 || n === null) return json({ error: "주간 한도가 맞지 않아요" }, 400);
    stmts.push(env.DB.prepare("INSERT INTO gc_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(`cap:${key}`, n));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true });
};
