// POST /api/shop/orders { itemId } -> 구매 신청 (1군만, 판매 중인 물건, 내 플래티넘 지갑 안에서). 오피서 이상에게 알림이 간다
import { NEED_LOGIN, RANK, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";
import { effective, loadCatalog, loadRules, loadSettings, wallet } from "../../../../server/platshop";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const guild = await env.DB.prepare("SELECT guild FROM profiles WHERE user_id = ?").bind(me.id).first<{ guild: string | null }>();
  const high = (await env.DB.prepare("SELECT high_spec FROM users WHERE id = ?").bind(me.id).first<{ high_spec: number }>())?.high_spec === 1;
  if (guild?.guild !== "main") return json({ error: "1군 길드원만 살 수 있어요" }, 403);
  const { itemId } = await readJson<{ itemId: unknown }>(request);
  const [catalog, settings, rules] = await Promise.all([loadCatalog(env, request), loadSettings(env), loadRules(env)]);
  if (!settings.open && RANK[me.role] < 1) return json({ error: "준비 중이에요" }, 409);
  const item = catalog.find((it) => it.id === itemId);
  if (!item) return json({ error: "없는 물건이에요" }, 404);
  const e = effective(item, settings, rules.get(item.id));
  if (!e.enabled) return json({ error: "지금은 팔지 않는 물건이에요" }, 409);
  const now = Date.now();
  // 내 플래티넘 지갑 (제작자 요청: 매주 300씩 지급되고 쌓인다. 고스펙은 따로)
  const w = await wallet(env, me.id, true, high, settings, now);
  if (item.plat > w.balance) {
    return json({ error: `플래티넘이 모자라요 (가진 것 ${w.balance.toLocaleString("ko-KR")} / 이 물건 ${item.plat.toLocaleString("ko-KR")})` }, 409);
  }
  const row = await env.DB.prepare(
    "INSERT INTO plat_orders (user_id, item_id, item_name, plat, gold, ratio, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'requested', ?) RETURNING id",
  )
    .bind(me.id, item.id, item.name, item.plat, high ? e.highGold : e.gold, high ? e.highRatio : e.ratio, now)
    .first<{ id: number }>();
  const staff = await env.DB.prepare("SELECT id FROM users WHERE role IN ('developer', 'master', 'officer')").all<{ id: string }>();
  await notify(
    env,
    staff.results.map((u) => u.id),
    "shop",
    `${me.id}님이 ${item.name} 구매 신청 (${(high ? e.highGold : e.gold).toLocaleString("ko-KR")}골드${high ? ", 고스펙" : ""})`,
    "#/shop",
    me.id,
  );
  return json({ id: row?.id, itemId: item.id, gold: high ? e.highGold : e.gold, status: "requested" }, 201);
};
