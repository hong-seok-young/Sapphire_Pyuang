// GET    /api/fix/:id -> 접수 하나와 대화 (운영진이나 쓴 사람)
// PUT    /api/fix/:id { status, patch?, version? } -> 접수 · 처리 중 · 고침 (운영진). 고침은 패치 내역 한 줄(patch)과 함께, 쓴 사람에게 알림
// DELETE /api/fix/:id -> 지우기 (운영진, 장난·겹친 접수)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import { FIX_KINDS, FIX_STATUS, canSeeFix, clip, deviceText, loadFix, ownsFix } from "../../../server/fix";
import type { FixStatus } from "../../../server/fix";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const r = await loadFix(env, Number(params.id));
  if (!r || !(canSeeFix(me) || ownsFix(me, r.user_id))) return json({ error: "없는 접수예요" }, 404);
  const [talk, shots] = await env.DB.batch([
    env.DB.prepare(
      "SELECT t.id, t.user_id, t.text, t.created_at, COALESCE(u.role, 'member') AS role FROM fix_talk t LEFT JOIN users u ON u.id = t.user_id WHERE t.report_id = ? ORDER BY t.id",
    ).bind(r.id),
    env.DB.prepare("SELECT id FROM fix_shots WHERE report_id = ? ORDER BY id").bind(r.id),
  ]);
  return json({
    talk: talk.results,
    report: {
      ...r,
      device: undefined,
      trail: r.trail ? (JSON.parse(r.trail) as string[]) : [],
      deviceName: deviceText(r.device),
      shots: (shots.results as { id: number }[]).map((s) => s.id),
      talks: talk.results.length,
    },
  });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canSeeFix(me)) return FORBIDDEN();
  const r = await loadFix(env, Number(params.id));
  if (!r) return json({ error: "없는 접수예요" }, 404);
  const body = await readJson<{ status: unknown; patch: unknown; version: unknown }>(request);
  const status = body.status as FixStatus;
  if (!(FIX_STATUS as readonly string[]).includes(status)) return json({ error: "상태가 맞지 않아요" }, 400);
  const patch = typeof body.patch === "string" ? body.patch.trim().slice(0, 80) : "";
  if (status === "done" && !patch) return json({ error: "패치 내역에 넣을 한 줄을 적어 주세요" }, 400);
  const version = typeof body.version === "string" ? body.version.slice(0, 10) : "";
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE fix_reports SET status = ?, done_at = ?, done_by = ?, patch = ? WHERE id = ?").bind(
      status,
      status === "done" ? now : null,
      status === "done" ? me.id : null,
      status === "done" ? patch : null,
      r.id,
    ),
    env.DB.prepare("DELETE FROM patch_extra WHERE report_id = ?").bind(r.id),
    ...(status === "done" && version
      ? [env.DB.prepare("INSERT INTO patch_extra (version, text, report_id, created_at) VALUES (?, ?, ?, ?)").bind(version, patch, r.id, now)]
      : []),
  ]);
  if (status !== r.status) {
    const kind = FIX_KINDS[r.kind] ?? "접수";
    if (status === "done") await notify(env, [r.user_id], "fix", `[개선 접수] 보내 주신 ${kind}을 고쳤어요 · ${patch}`, `#/fix?r=${r.id}`, me.id);
    else if (status === "doing") await notify(env, [r.user_id], "fix", `[개선 접수] 확인하고 고치는 중이에요 · ${r.menu} · ${clip(r.text, 30)}`, `#/fix?r=${r.id}`, me.id);
  }
  return json({ ok: true, status });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canSeeFix(me)) return FORBIDDEN();
  const id = Number(params.id);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM fix_shots WHERE report_id = ?").bind(id),
    env.DB.prepare("DELETE FROM fix_talk WHERE report_id = ?").bind(id),
    env.DB.prepare("DELETE FROM patch_extra WHERE report_id = ?").bind(id),
    env.DB.prepare("DELETE FROM fix_reports WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
};
