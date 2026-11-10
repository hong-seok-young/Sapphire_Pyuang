// POST /api/gcoin/adjust { userId, delta, note } -> 오피서가 성장코인을 손으로 더하거나 뺀다 (잘못 적은 레벨, 이벤트 보상 등). 2군 본캐에게만, 메모는 꼭
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import type { Env } from "../../../server/auth";
import { MAX_NOTE, canManageGcoin, canUseGcoin, gcoinOpen, int, isMember, text } from "../../../server/gcoin";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseGcoin(me) || !canManageGcoin(me.role)) return FORBIDDEN();
  const b = await readJson<{ userId: unknown; delta: unknown; note: unknown }>(request);
  const userId = typeof b.userId === "string" ? b.userId : "";
  const delta = int(b.delta, -100_000, 100_000);
  const note = text(b.note, MAX_NOTE);
  if (!userId || !(await isMember(env, userId))) return json({ error: "2군 본캐가 아니에요" }, 400);
  if (delta === null || delta === 0) return json({ error: "코인이 맞지 않아요" }, 400);
  if (!note) return json({ error: `왜 바꾸는지 ${MAX_NOTE}자 안으로 적어 주세요` }, 400);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO gc_ledger (user_id, delta, kind, ref, note, by_user, created_at) VALUES (?, ?, 'adjust', ?, ?, ?, ?)")
    .bind(userId, delta, `a${now}-${Math.random().toString(36).slice(2, 8)}`, note, me.id, now)
    .run();
  if (gcoinOpen()) await notify(env, [userId], "gcoin", `성장코인 ${delta > 0 ? "+" : ""}${delta} · ${note}`, "#/gcoin?t=mine", me.id);
  return json({ ok: true });
};
