// 도감 계산기 완료 체크 서버 저장 (제작자 2026-11-19 '도감은 완료 체크하는 거 힘들거든 백업', '섬예 거 백업해서 자동으로 넣어주고'):
// 전에는 그 기기(localStorage)에만 있어서 다른 폰·PC 에서는 0 이었다. 캐릭터마다 한 줄 (항목 이름 목록, 고친 때).
// GET /api/dex/done -> { names, at }   (at 0 = 서버에 아직 없음)
// PUT /api/dex/done { names, at } -> { ok, at }  (더 늦게 고친 것만 덮는다: 다른 기기의 예전 목록이 새 것을 덮지 않게)
// 화면(src/pages/Dex.tsx)이 열 때 이 기기 것과 견주어 새 쪽으로 맞추고, 고칠 때마다 1.2초 모아 보낸다. 사용 기록에는 남기지 않는다 (_middleware.ts).
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";

const MAX_NAMES = 4000;
const MAX_NAME = 80;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await env.DB.prepare("SELECT names, updated_at FROM dex_done WHERE user_id = ?").bind(me.id).first<{ names: string; updated_at: number }>();
  let names: string[] = [];
  try {
    if (row) names = JSON.parse(row.names) as string[];
  } catch {
    /* 깨진 값은 빈 목록 */
  }
  return json({ names, at: row?.updated_at ?? 0 });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ names: unknown; at: unknown }>(request);
  if (!Array.isArray(b.names) || b.names.length > MAX_NAMES || b.names.some((n) => typeof n !== "string" || !n || n.length > MAX_NAME)) {
    return json({ error: "목록이 맞지 않아요" }, 400);
  }
  const now = Date.now();
  const at = typeof b.at === "number" && Number.isFinite(b.at) && b.at > 0 && b.at <= now + 60_000 ? Math.round(b.at) : now;
  const names = [...new Set(b.names as string[])];
  await env.DB.prepare(
    "INSERT INTO dex_done (user_id, names, n, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (user_id) DO UPDATE SET names = excluded.names, n = excluded.n, updated_at = excluded.updated_at WHERE excluded.updated_at >= dex_done.updated_at",
  ).bind(me.id, JSON.stringify(names), names.length, at).run();
  return json({ ok: true, at });
};
