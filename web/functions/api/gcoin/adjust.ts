// POST /api/gcoin/adjust { userId, delta, note } -> 오피서가 성장코인을 손으로 더하거나 뺀다 (잘못 적은 레벨, 이벤트 보상 등). 2군 본캐에게만, 메모는 꼭
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import type { Env } from "../../../server/auth";
import { MAX_NOTE, canManageGcoin, canUseGcoin, g1Open, gcoinOpen, gcoinPath, grpOf, int, isMember, text } from "../../../server/gcoin";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseGcoin(me) || !canManageGcoin(me)) return FORBIDDEN();
  const b = await readJson<{ g?: unknown; userId: unknown; delta: unknown; note: unknown }>(request);
  const grp = grpOf(b.g);
  const userId = typeof b.userId === "string" ? b.userId : "";
  const delta = int(b.delta, -100_000, 100_000);
  const note = text(b.note, MAX_NOTE);
  if (!userId || !(await isMember(env, userId, grp))) return json({ error: "성장코인 대상자가 아니에요" }, 400);
  if (delta === null || delta === 0) return json({ error: "코인이 맞지 않아요" }, 400);
  if (!note) return json({ error: `왜 바꾸는지 ${MAX_NOTE}자 안으로 적어 주세요` }, 400);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO gc_ledger (user_id, delta, kind, ref, note, by_user, created_at, grp) VALUES (?, ?, 'adjust', ?, ?, ?, ?, ?)")
    .bind(userId, delta, `a${now}-${Math.random().toString(36).slice(2, 8)}`, note, me.id, now, grp === 1 ? 1 : null)
    .run();
  // 1군 (제작자 2026-11-15 '담당자가 코인 더 주면 받은 사람은 알림과 성장코인샵 뱃지와 들어왔을 때 한 번 팝업, 어떤 이유로 받았다고'):
  // 알림은 오픈 뒤에만 (그 전에는 들어올 수 없다). 배지·팝업은 열린 뒤 처음 들어올 때 (gift1_seen)
  if (grp === 1) {
    if (await g1Open(env))
      await notify(env, [userId], "gcoin", delta > 0 ? `[1군 성장코인] +${delta} 받았어요 · 사유: ${note}` : `[1군 성장코인] ${delta} · 사유: ${note}`, `${gcoinPath(grp)}?t=mine`, me.id);
  } else if (gcoinOpen()) await notify(env, [userId], "gcoin", `성장코인 ${delta > 0 ? "+" : ""}${delta} · ${note}`, `${gcoinPath(grp)}?t=mine`, me.id);
  return json({ ok: true });
};
