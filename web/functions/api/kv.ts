// 화면 기록 서버 저장 (제작자 2026-11-19 '로컬에만 남는 거 아니지? 모든 거를 서버에 기록을 하면 좋을 것 같아'):
// 도감 내 수치·다른 캐릭 수치, 새 글 배지 본 때, UPDATE 표 본 메뉴, 튜토리얼 본 메뉴, 최근 검색어, 배경 설정, '다시 안 보기' 같은 것이
// 그 기기(localStorage)에만 있어서 다른 폰·PC 에서는 처음부터였다. 화면(src/userSync.ts)이 정한 열쇠만 캐릭터마다 한 줄씩 둔다.
// GET /api/kv -> { items: [k, v|null, at][] }
// PUT /api/kv { items: [{ k, v: string|null, at }] } -> { ok }  (더 늦게 고친 것만 덮는다). 사용 기록에는 남기지 않는다 (_middleware.ts)
// 기기마다 따로여야 하는 것(기기 표, 로그인 열쇠, 받은 판, 설치 아이콘, 폰 알림, 날씨 위치)은 화면이 보내지 않는다.
import { NEED_LOGIN, currentUser, json, readJson } from "../../server/auth";
import type { Env } from "../../server/auth";

const KEY_RE = /^sapphire[.-][\w.\-:%가-힣]{1,110}$/;
const MAX_VALUE = 60_000;
const MAX_ROWS = 300;
const MAX_ITEMS = 40;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const { results } = await env.DB.prepare("SELECT k, v, at FROM user_kv WHERE user_id = ? LIMIT ?").bind(me.id, MAX_ROWS).all<{ k: string; v: string | null; at: number }>();
  return json({ items: results.map((r) => [r.k, r.v, r.at]) });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ items: unknown }>(request);
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > MAX_ITEMS) return json({ error: "맞지 않아요" }, 400);
  const now = Date.now();
  const items: { k: string; v: string | null; at: number }[] = [];
  for (const x of b.items as { k?: unknown; v?: unknown; at?: unknown }[]) {
    if (typeof x?.k !== "string" || !KEY_RE.test(x.k)) return json({ error: "열쇠가 맞지 않아요" }, 400);
    if (x.v !== null && (typeof x.v !== "string" || x.v.length > MAX_VALUE)) return json({ error: "값이 맞지 않아요" }, 400);
    const at = typeof x.at === "number" && Number.isFinite(x.at) && x.at > 0 && x.at <= now + 60_000 ? Math.round(x.at) : now;
    items.push({ k: x.k, v: x.v as string | null, at });
  }
  // 한 사람 줄 수 한도: 새 열쇠는 한도 안에서만 (있는 줄 고치기는 그대로)
  const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_kv WHERE user_id = ?").bind(me.id).first<{ n: number }>();
  const room = MAX_ROWS - (cnt?.n ?? 0);
  const sql = room > 0
    ? "INSERT INTO user_kv (user_id, k, v, at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (user_id, k) DO UPDATE SET v = excluded.v, at = excluded.at WHERE excluded.at > user_kv.at"
    : "UPDATE user_kv SET v = ?3, at = ?4 WHERE user_id = ?1 AND k = ?2 AND at < ?4";
  await env.DB.batch(items.map((x) => env.DB.prepare(sql).bind(me.id, x.k, x.v, x.at)));
  return json({ ok: true });
};
