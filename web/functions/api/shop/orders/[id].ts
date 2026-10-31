// PATCH /api/shop/orders/:id { action: "done" | "cancel" } -> 거래 완료(오피서 이상, 게임에서 물건을 주고 골드를 받은 뒤)
//       또는 취소(신청한 사람이나 오피서 이상, 아직 끝나지 않은 신청만). 완료는 정산 기록(쓴 플래티넘, 받은 골드)에 쌓인다
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  const order = Number.isInteger(id)
    ? await env.DB.prepare("SELECT id, user_id, item_name, gold, status FROM plat_orders WHERE id = ?")
        .bind(id)
        .first<{ id: number; user_id: string; item_name: string; gold: number; status: string }>()
    : null;
  if (!order) return json({ error: "없는 신청이에요" }, 404);
  const manager = RANK[me.role] >= 1;
  const { action } = await readJson<{ action: unknown }>(request);
  if (order.status !== "requested") return json({ error: "이미 끝난 신청이에요" }, 409);
  const now = Date.now();
  if (action === "done") {
    if (!manager) return FORBIDDEN();
    await env.DB.prepare("UPDATE plat_orders SET status = 'done', done_at = ?, done_by = ? WHERE id = ? AND status = 'requested'")
      .bind(now, me.id, order.id)
      .run();
    await notify(env, [order.user_id], "shop", `${order.item_name} 거래 완료 (${order.gold.toLocaleString("ko-KR")}골드)`, "#/shop", me.id);
    return json({ id: order.id, status: "done" });
  }
  if (action === "cancel") {
    if (!manager && order.user_id !== me.id) return FORBIDDEN();
    await env.DB.prepare("UPDATE plat_orders SET status = 'cancelled', done_at = ?, done_by = ? WHERE id = ? AND status = 'requested'")
      .bind(now, me.id, order.id)
      .run();
    if (order.user_id !== me.id) await notify(env, [order.user_id], "shop", `${order.item_name} 구매 신청이 취소됐어요`, "#/shop", me.id);
    return json({ id: order.id, status: "cancelled" });
  }
  return json({ error: "할 일이 맞지 않아요" }, 400);
};
