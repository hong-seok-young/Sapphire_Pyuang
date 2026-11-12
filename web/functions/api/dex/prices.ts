// 도감 계산기 시세 비교 값 (제작자 2026-11-12 '이 값들은 나만 바꾸게, 골드 값 등등 나만 세팅할 수 있어야'):
// GET  /api/dex/prices -> { set: { scroll, stamp, plat? } }  (로그인한 누구나, 모두가 같은 값으로 셈)
// PUT  /api/dex/prices { scroll, stamp, plat? } -> { ok }    (앱개발자만)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";

const SCROLL_KEY = /^(무기|갑옷) (D|C|B|A|S|SS)$/;
const STAMP_KEY = /^(normal|event) (S|A|B)$/;

function clean(obj: unknown, key: RegExp, max: number): Record<string, number> | null {
  if (obj == null) return {};
  if (typeof obj !== "object" || Array.isArray(obj)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (!key.test(k) || typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) return null;
    out[k] = v;
  }
  return out;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await env.DB.prepare("SELECT data FROM dex_price_set WHERE id = 1").first<{ data: string }>();
  let set: unknown = { scroll: {}, stamp: {} };
  try {
    if (row) set = JSON.parse(row.data);
  } catch {
    /* 깨진 값은 빈 값으로 */
  }
  return json({ set, canEdit: me.role === "developer" });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (me.role !== "developer") return FORBIDDEN();
  const b = await readJson<{ scroll?: unknown; stamp?: unknown; plat?: unknown }>(request);
  const scroll = clean(b.scroll, SCROLL_KEY, 1e10);
  const stamp = clean(b.stamp, STAMP_KEY, 1e6);
  const plat = b.plat == null ? undefined : typeof b.plat === "number" && Number.isFinite(b.plat) && b.plat >= 0 && b.plat <= 1e5 ? b.plat : null;
  if (!scroll || !stamp || plat === null) return json({ error: "값이 맞지 않아요" }, 400);
  const data = JSON.stringify(plat === undefined ? { scroll, stamp } : { scroll, stamp, plat });
  await env.DB.prepare(
    "INSERT INTO dex_price_set (id, data, updated_at, updated_by) VALUES (1, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
  ).bind(data, Date.now(), me.id).run();
  return json({ ok: true });
};
