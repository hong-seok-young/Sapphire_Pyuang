// PATCH /api/shop/orders/:id { action: "done" | "cancel" } -> 거래 완료(오피서 이상, 게임에서 물건을 주고 골드를 받은 뒤)
//       또는 취소(신청한 사람이나 오피서 이상, 아직 끝나지 않은 신청만). 완료는 정산 기록(쓴 플래티넘, 받은 골드)에 쌓인다
// PATCH { action: "void" | "restore" } -> 정산에서 지우기 / 복구 (오피서 이상, 끝난 거래. 제작자 요청 2026-11-01: 시험 거래 등.
//       기록은 남기고 정산 합계와 그 사람의 플래티넘 이용한도에서 뺀다)
// PATCH { action: "gold", gold } -> 실제로 받은 골드 (오피서 이상, 거래 완료한 것. 49,500 대신 5만을 받는 일이 있어서. 공짜로 줬으면 0)
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  const order = Number.isInteger(id)
    ? await env.DB.prepare("SELECT id, user_id, item_name, gold, status, voided_at FROM plat_orders WHERE id = ?")
        .bind(id)
        .first<{ id: number; user_id: string; item_name: string; gold: number; status: string; voided_at: number | null }>()
    : null;
  if (!order) return json({ error: "없는 신청이에요" }, 404);
  const manager = RANK[me.role] >= 1;
  const { action, gold } = await readJson<{ action: unknown; gold: unknown }>(request);
  const now = Date.now();
  // 끝난 거래 고치기 (정산)
  if (action === "void" || action === "restore" || action === "gold") {
    if (!manager) return FORBIDDEN();
    if (order.status === "requested") return json({ error: "아직 거래 전이에요" }, 409);
    if (action === "void") {
      await env.DB.prepare("UPDATE plat_orders SET voided_at = ?, voided_by = ? WHERE id = ? AND voided_at IS NULL").bind(now, me.id, order.id).run();
      return json({ id: order.id, voided: true });
    }
    if (action === "restore") {
      await env.DB.prepare("UPDATE plat_orders SET voided_at = NULL, voided_by = NULL WHERE id = ?").bind(order.id).run();
      return json({ id: order.id, voided: false });
    }
    if (order.status !== "done") return json({ error: "거래 완료한 것만 받은 골드를 적어요" }, 409);
    if (!Number.isInteger(gold) || (gold as number) < 0 || (gold as number) > 1_000_000_000) return json({ error: "받은 골드를 0 이상 숫자로 적어 주세요" }, 400);
    const paid = gold === order.gold ? null : (gold as number);
    await env.DB.prepare("UPDATE plat_orders SET gold_paid = ? WHERE id = ?").bind(paid, order.id).run();
    return json({ id: order.id, goldPaid: paid });
  }
  if (order.status !== "requested") return json({ error: "이미 끝난 신청이에요" }, 409);
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
