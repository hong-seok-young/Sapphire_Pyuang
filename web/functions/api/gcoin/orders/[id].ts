// PATCH /api/gcoin/orders/:id { action, note? }
//   done   오피서 이상: 게임 안에서 준 뒤 지급 완료 (신청한 사람에게 알림)
//   reject 오피서 이상: 반려 (코인이 돌아간다, 의견은 신청한 사람에게)
//   cancel 신청한 사람: 기다리는 동안 취소 (코인이 돌아간다)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";
import type { Env } from "../../../../server/auth";
import { MAX_NOTE, canManageGcoin, canUseGcoin, text } from "../../../../server/gcoin";

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseGcoin(me)) return FORBIDDEN();
  const id = Number(paramId(params));
  if (!Number.isInteger(id)) return json({ error: "없는 신청이에요" }, 404);
  const o = await env.DB.prepare("SELECT * FROM gc_orders WHERE id = ?").bind(id).first<{
    id: number;
    user_id: string;
    name: string;
    unit: string | null;
    price: number;
    qty: number;
    status: string;
  }>();
  if (!o) return json({ error: "없는 신청이에요" }, 404);
  if (o.status !== "pending") return json({ error: "이미 처리됐어요" }, 409);
  const b = await readJson<{ action: string; note: unknown }>(request);
  const now = Date.now();
  const label = `${o.name}${o.unit ? ` ${o.unit}` : ""}${o.qty > 1 ? ` x${o.qty}` : ""}`;
  // 상태가 pending 일 때만 바꾼다 (두 사람이 같이 눌러도 한 번만)
  const set = (status: string, note: string | null) =>
    env.DB.prepare("UPDATE gc_orders SET status = ?, note = ?, done_at = ?, done_by = ? WHERE id = ? AND status = 'pending'")
      .bind(status, note, now, me.id, o.id)
      .run();

  if (b.action === "cancel") {
    if (o.user_id !== me.id) return FORBIDDEN();
    await set("cancel", null);
    return json({ ok: true });
  }
  if (!canManageGcoin(me.role)) return FORBIDDEN();
  if (b.action === "done") {
    const r = await set("done", null);
    if (r.meta.changes) await notify(env, [o.user_id], "gcoin", `성장코인샵 지급 완료 · ${label}`, "#/gcoin?t=mine", me.id);
    return json({ ok: true });
  }
  if (b.action === "reject") {
    const note = text(b.note, MAX_NOTE);
    if (note === undefined) return json({ error: `의견은 ${MAX_NOTE}자까지예요` }, 400);
    const r = await set("reject", note);
    if (r.meta.changes)
      await notify(env, [o.user_id], "gcoin", `성장코인샵 신청 반려 · ${label} · 코인 ${o.price * o.qty}개가 돌아왔어요${note ? ` · “${note}”` : ""}`, "#/gcoin?t=mine", me.id);
    return json({ ok: true });
  }
  return json({ error: "할 일이 맞지 않아요" }, 400);
};
