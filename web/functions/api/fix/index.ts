// 오류·개선 접수 (server/fix.ts)
// GET  /api/fix?status=new|doing|done -> 개선 접수 목록 (오피서·길드마스터·앱개발자)
// GET  /api/fix?mine=1               -> 내 접수 (누구나, 묶은 캐릭터 것)
// POST /api/fix { kind, menu, menuKey, path, text, version, trail } -> 접수 (누구나). 스샷은 그 뒤 /api/fix/:id/shots
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import { FIX_KINDS, FIX_STATUS, canSeeFix, clip, deviceText, fixStaff, isFixKind } from "../../../server/fix";
import type { FixRow, FixStatus } from "../../../server/fix";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const url = new URL(request.url);
  const mine = url.searchParams.get("mine") === "1";
  if (!mine && !canSeeFix(me)) return FORBIDDEN();
  const status = (FIX_STATUS as readonly string[]).includes(url.searchParams.get("status") ?? "") ? (url.searchParams.get("status") as FixStatus) : "new";
  const chars = me.chars ?? [me.id];
  const [list, counts] = await env.DB.batch([
    mine
      ? env.DB.prepare(
          "SELECT * FROM fix_reports WHERE user_id IN (SELECT value FROM json_each(?)) ORDER BY id DESC LIMIT 100",
        ).bind(JSON.stringify(chars))
      : env.DB.prepare(`SELECT * FROM fix_reports WHERE status = ? ORDER BY ${status === "done" ? "done_at" : "created_at"} DESC LIMIT 100`).bind(status),
    mine
      ? env.DB.prepare("SELECT 1 WHERE 0")
      : env.DB.prepare("SELECT status, kind, COUNT(*) AS n FROM fix_reports GROUP BY status, kind"),
  ]);
  const rows = list.results as unknown as FixRow[];
  const ids = rows.map((r) => r.id);
  const [shots, talks] = ids.length
    ? await env.DB.batch([
        env.DB.prepare("SELECT id, report_id FROM fix_shots WHERE report_id IN (SELECT value FROM json_each(?)) ORDER BY id").bind(JSON.stringify(ids)),
        env.DB.prepare("SELECT report_id, COUNT(*) AS n FROM fix_talk WHERE report_id IN (SELECT value FROM json_each(?)) GROUP BY report_id").bind(
          JSON.stringify(ids),
        ),
      ])
    : [{ results: [] }, { results: [] }];
  const shotOf = new Map<number, number[]>();
  for (const s of shots.results as { id: number; report_id: number }[]) shotOf.set(s.report_id, [...(shotOf.get(s.report_id) ?? []), s.id]);
  const talkOf = new Map((talks.results as { report_id: number; n: number }[]).map((t) => [t.report_id, t.n]));
  return json({
    reports: rows.map((r) => ({
      ...r,
      device: undefined,
      trail: r.trail ? (JSON.parse(r.trail) as string[]) : [],
      deviceName: deviceText(r.device),
      shots: shotOf.get(r.id) ?? [],
      talks: talkOf.get(r.id) ?? 0,
    })),
    counts: counts.results,
  });
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const body = await readJson<{ kind: unknown; menu: unknown; menuKey: unknown; path: unknown; text: unknown; version: unknown; trail: unknown }>(request);
  if (!isFixKind(body.kind)) return json({ error: "종류를 골라 주세요" }, 400);
  const text = str(body.text, 2000);
  if (text.length < 2) return json({ error: "내용을 적어 주세요" }, 400);
  const menu = str(body.menu, 60) || "앱";
  const path = str(body.path, 300) || "#/";
  const trail = Array.isArray(body.trail) ? body.trail.filter((t): t is string => typeof t === "string").slice(-5).map((t) => t.slice(0, 80)) : [];
  // 한 사람이 1시간에 10개까지 (잘못 여러 번 누르는 것 막기)
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM fix_reports WHERE user_id = ? AND created_at > ?").bind(me.id, now - 3_600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 10) return json({ error: "조금 뒤에 다시 보내 주세요" }, 429);
  const row = await env.DB.prepare(
    "INSERT INTO fix_reports (user_id, kind, menu, menu_key, path, text, device, version, trail, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?) RETURNING id",
  )
    .bind(me.id, body.kind, menu, str(body.menuKey, 30) || null, path, text, request.headers.get("user-agent")?.slice(0, 400) ?? null, str(body.version, 10) || null, JSON.stringify(trail), now)
    .first<{ id: number }>();
  const id = row?.id ?? 0;
  const staff = (await fixStaff(env)).filter((u) => !(me.chars ?? [me.id]).includes(u));
  await notify(env, staff, "fix", `[${FIX_KINDS[body.kind]}] ${menu} · ${me.id}: ${clip(text)}`, `#/gaps?r=${id}`, me.id);
  return json({ id }, 201);
};
