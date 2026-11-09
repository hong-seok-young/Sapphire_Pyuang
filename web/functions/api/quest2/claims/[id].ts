// PATCH /api/quest2/claims/:id { action: "pay" | "reject", note? } -> 오피서 이상만.
//   pay    게임 안에서 실제로 준 뒤: 목표의 paid_to_level 을 이 신청의 to_level 로 올리고 신청자에게 알림
//   reject 거절 (의견은 신청자에게): paid_to_level 은 그대로라 다시 신청할 수 있다
import { FORBIDDEN, NEED_LOGIN, currentUser, json, paramId, readJson } from "../../../../server/auth";
import { notify } from "../../../../server/alerts";
import type { Env } from "../../../../server/auth";
import { MAX_NOTE, canManageQuest2, canUseQuest2, text } from "../../../../server/quest2";
import type { ClaimRow, TargetRow } from "../../../../server/quest2";

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseQuest2(me) || !canManageQuest2(me.role)) return FORBIDDEN();
  const id = Number(paramId(params));
  if (!Number.isInteger(id)) return json({ error: "없는 신청이에요" }, 404);
  const claim = await env.DB.prepare("SELECT * FROM quest2_claims WHERE id = ?").bind(id).first<ClaimRow>();
  if (!claim) return json({ error: "없는 신청이에요" }, 404);
  if (claim.status !== "pending") return json({ error: "이미 처리됐어요" }, 409);
  const target = await env.DB.prepare("SELECT * FROM quest2_targets WHERE id = ?").bind(claim.target_id).first<TargetRow>();
  if (!target) return json({ error: "없는 목표예요" }, 404);

  const body = await readJson<{ action: string; note: unknown }>(request);
  const now = Date.now();

  if (body.action === "pay") {
    await env.DB.batch([
      env.DB.prepare("UPDATE quest2_claims SET status = 'paid', paid_at = ?, paid_by = ? WHERE id = ?").bind(now, me.id, claim.id),
      env.DB.prepare("UPDATE quest2_targets SET paid_to_level = ?, updated_at = ? WHERE id = ? AND paid_to_level = ?").bind(claim.to_level, now, target.id, claim.from_level),
    ]);
    const goldText = claim.gold ? ` · ${claim.gold.toLocaleString("ko-KR")}골드` : "";
    await notify(env, [claim.user_id], "quest2", `2군 성장 퀘스트 보상 지급 완료${goldText}`, "#/quest2", me.id);
    return json({ ok: true });
  }

  if (body.action === "reject") {
    const note = text(body.note, MAX_NOTE);
    if (note === undefined) return json({ error: `의견은 ${MAX_NOTE}자까지예요` }, 400);
    await env.DB.prepare("UPDATE quest2_claims SET status = 'rejected', paid_at = ?, paid_by = ? WHERE id = ?").bind(now, me.id, claim.id).run();
    await notify(env, [claim.user_id], "quest2", `2군 성장 퀘스트 보상 신청이 반려됐어요${note ? ` · “${note}”` : ""}`, "#/quest2", me.id);
    return json({ ok: true });
  }

  return json({ error: "할 일이 맞지 않아요" }, 400);
};
