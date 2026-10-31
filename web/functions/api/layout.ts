// GET /api/layout -> { layout: { dock, grid } | null } : 이 계정의 홈 칸과 아래 탭 배치 (없으면 null, 화면이 기본 배치를 쓴다)
// PUT /api/layout { dock, grid } -> 배치 저장. 칸 이름은 화면(src/launcher.ts)이 정하고 서버는 모양과 길이만 본다
// (제작자 요청 2026-11-01: 갤럭시·아이폰 홈 화면처럼 각자 옮기기. 다른 기기에서도 같은 배치)
import { NEED_LOGIN, currentUser, json, readJson } from "../../server/auth";
import type { Env } from "../../server/auth";

const MAX_KEYS = 60;
const keyList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length <= MAX_KEYS && v.every((k) => typeof k === "string" && /^[a-z]{1,20}$/.test(k)) ? (v as string[]) : null;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await env.DB.prepare("SELECT data FROM layouts WHERE user_id = ?").bind(me.id).first<{ data: string }>();
  let layout: unknown = null;
  try {
    layout = row ? JSON.parse(row.data) : null;
  } catch {
    layout = null;
  }
  return json({ layout });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const body = await readJson<{ dock: unknown; grid: unknown }>(request);
  const dock = keyList(body.dock);
  const grid = keyList(body.grid);
  if (!dock || !grid || dock.length > 5) return json({ error: "배치를 다시 해 주세요" }, 400);
  await env.DB.prepare(
    "INSERT INTO layouts (user_id, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (user_id) DO UPDATE SET data = ?2, updated_at = ?3",
  )
    .bind(me.id, JSON.stringify({ dock, grid }), Date.now())
    .run();
  return json({ ok: true });
};
