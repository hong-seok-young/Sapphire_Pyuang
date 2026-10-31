// GET /api/shop -> 플래티넘 할인 상점: 설정, 물건(실제 비율, 할인가, 시중가, 한도, 내가 기간 안에 산 수), 내 신청.
//     오피서 이상에게는 판매하지 않는 물건도, 아직 처리하지 않은 신청과 정산(쓴 플래티넘, 받은 골드)도 준다
//     열기 전(open 이 아님)에는 길드원에게 { open: false } 만 준다 ('준비 중이에요')
//     이번 주 내 플래티넘 한도 week { allowance, used, left, resetAt } 도 준다
// PUT /api/shop -> (오피서 이상) 통 설정 { ratio, highRatio, market, weekPlat, highWeekPlat, open }
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { effective, loadCatalog, loadRules, loadSettings, validPlat, validRatio, weekUse } from "../../../server/platshop";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const manager = RANK[me.role] >= 1;
  const [catalog, settings, rules] = await Promise.all([loadCatalog(env, request), loadSettings(env), loadRules(env)]);
  if (!manager && !settings.open) return json({ open: false });
  const now = Date.now();
  const mine = await env.DB.prepare(
    "SELECT id, item_id AS itemId, item_name AS itemName, plat, gold, ratio, status, created_at AS at, done_at AS doneAt " +
      "FROM plat_orders WHERE user_id = ? ORDER BY id DESC LIMIT 50",
  )
    .bind(me.id)
    .all<{ id: number; itemId: string; itemName: string; plat: number; gold: number; ratio: number; status: string; at: number; doneAt: number | null }>();
  const guild = await env.DB.prepare("SELECT guild FROM profiles WHERE user_id = ?").bind(me.id).first<{ guild: string | null }>();
  const flags = await env.DB.prepare("SELECT high_spec FROM users WHERE id = ?").bind(me.id).first<{ high_spec: number }>();

  const items = catalog.map((it) => ({ ...it, ...effective(it, settings, rules.get(it.id)) })).filter((it) => manager || it.enabled);
  const week = await weekUse(env, me.id, flags?.high_spec === 1, settings, now);

  let manage = null;
  if (manager) {
    const month = new Date();
    month.setDate(1);
    month.setHours(0, 0, 0, 0);
    const [pending, recent, total, thisMonth] = await env.DB.batch([
      env.DB.prepare(
        "SELECT id, user_id AS user, item_name AS itemName, plat, gold, ratio, created_at AS at FROM plat_orders WHERE status = 'requested' ORDER BY id",
      ),
      env.DB.prepare(
        "SELECT id, user_id AS user, item_name AS itemName, plat, gold, status, created_at AS at, done_at AS doneAt, done_by AS doneBy " +
          "FROM plat_orders WHERE status != 'requested' ORDER BY id DESC LIMIT 60",
      ),
      env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(plat), 0) AS plat, COALESCE(SUM(gold), 0) AS gold FROM plat_orders WHERE status = 'done'"),
      env.DB.prepare(
        "SELECT COUNT(*) AS n, COALESCE(SUM(plat), 0) AS plat, COALESCE(SUM(gold), 0) AS gold FROM plat_orders WHERE status = 'done' AND done_at >= ?",
      ).bind(month.getTime()),
    ]);
    manage = { pending: pending.results, recent: recent.results, total: total.results[0], month: thisMonth.results[0] };
  }
  return json({
    open: settings.open, settings, items, orders: mine.results, main: guild?.guild === "main", highSpec: flags?.high_spec === 1, manager, manage, week,
  });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (RANK[me.role] < 1) return FORBIDDEN();
  const b = await readJson<{ ratio: unknown; highRatio: unknown; market: unknown; weekPlat: unknown; highWeekPlat: unknown; open: unknown }>(request);
  if (
    !validRatio(b.ratio) || !validRatio(b.highRatio) || !validRatio(b.market) || !validPlat(b.weekPlat) || !validPlat(b.highWeekPlat) ||
    typeof b.open !== "boolean"
  ) {
    return json({ error: "비율은 0보다 크게, 주당 플래티넘은 0 이상으로 적어 주세요" }, 400);
  }
  await env.DB.prepare(
    "INSERT INTO plat_settings (id, ratio, high_ratio, market, week_plat, high_week_plat, open, updated_by, updated_at) " +
      "VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (id) DO UPDATE SET ratio = ?1, high_ratio = ?2, market = ?3, week_plat = ?4, " +
      "high_week_plat = ?5, open = ?6, updated_by = ?7, updated_at = ?8",
  )
    .bind(b.ratio, b.highRatio, b.market, b.weekPlat, b.highWeekPlat, b.open ? 1 : 0, me.id, Date.now())
    .run();
  return json({ ...(await loadSettings(env)) });
};
