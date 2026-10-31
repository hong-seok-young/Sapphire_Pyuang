// GET /api/favorites -> 내 즐겨찾기 (아이템, 몬스터, 사냥터. 제작자 요청). 최근에 단 것부터
// PUT /api/favorites { kind, key, name, on } -> 달기(on: true) / 빼기
// 계정마다 서버에 두어서 폰, PC, 홈 화면 웹앱 어디서나 같다. 한 사람 200개까지
import { NEED_LOGIN, currentUser, json, readJson } from "../../server/auth";
import type { Env } from "../../server/auth";

const KINDS = ["item", "monster", "place"] as const;
const MAX = 200;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const { results } = await env.DB.prepare("SELECT kind, key, name, created_at AS at FROM favorites WHERE user_id = ? ORDER BY created_at DESC")
    .bind(me.id)
    .all();
  return json(results);
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ kind: unknown; key: unknown; name: unknown; on: unknown }>(request);
  const ok =
    typeof b.kind === "string" && (KINDS as readonly string[]).includes(b.kind) &&
    typeof b.key === "string" && b.key.length > 0 && b.key.length <= 100 &&
    typeof b.name === "string" && b.name.length > 0 && b.name.length <= 100 && typeof b.on === "boolean";
  if (!ok) return json({ error: "즐겨찾기 내용이 맞지 않아요" }, 400);
  if (!b.on) {
    await env.DB.prepare("DELETE FROM favorites WHERE user_id = ? AND kind = ? AND key = ?").bind(me.id, b.kind, b.key).run();
    return json({ ok: true });
  }
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?").bind(me.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX) return json({ error: `즐겨찾기는 ${MAX}개까지예요` }, 400);
  await env.DB.prepare(
    "INSERT INTO favorites (user_id, kind, key, name, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, kind, key) DO NOTHING",
  )
    .bind(me.id, b.kind, b.key, b.name, Date.now())
    .run();
  return json({ ok: true });
};
