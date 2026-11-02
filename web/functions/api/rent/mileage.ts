// GET /api/rent/mileage?who=닉네임 -> 그 사람(묶은 캐릭터 모두)의 마일리지와 장부 최근 100줄 (운영진)
// POST /api/rent/mileage { who, delta, reason: "donate" | "adjust", note } -> 마일리지 적립·차감 (운영진: 장비 기부는 옵션 시세를 보고 💎 로, 기부는 note 에 장비 이름이 꼭)
// 장부는 지우지 않는다. 남는 마일리지가 0 보다 작아지게는 못 뺀다. 앱 계정이면 그 사람에게 알림
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import { canEnter, isManager, mileageOfName } from "../../../server/rental";

/** 닉네임과 같은 사람의 캐릭터들 (앱에 없으면 그 닉네임만) */
async function namesOf(env: Env, who: string): Promise<string[]> {
  const u = await env.DB.prepare("SELECT COALESCE(main_id, id) AS owner FROM users WHERE id = ?").bind(who).first<{ owner: string }>();
  if (!u) return [who];
  const { results } = await env.DB.prepare("SELECT id FROM users WHERE id = ?1 OR main_id = ?1").bind(u.owner).all<{ id: string }>();
  return results.map((r) => r.id);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me) || !isManager(me)) return FORBIDDEN();
  const who = (new URL(request.url).searchParams.get("who") ?? "").trim();
  if (!who) return json({ error: "닉네임을 적어 주세요" }, 400);
  const names = await namesOf(env, who);
  const { results } = await env.DB.prepare(
    `SELECT who, delta, gold, reason, note, by_user AS by, created_at AS at FROM rental_mileage WHERE who IN (${names.map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(...names)
    .all();
  return json({ who, names, mileage: await mileageOfName(env, who), ledger: results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me) || !isManager(me)) return FORBIDDEN();
  const b = await readJson<{ who: unknown; delta: unknown; reason: unknown; note: unknown }>(request);
  const who = typeof b.who === "string" ? b.who.trim() : "";
  const delta = Number(b.delta);
  const reason = b.reason === "donate" ? "donate" : "adjust";
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 100) : "";
  if (!who || who.length > 20) return json({ error: "닉네임을 적어 주세요" }, 400);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 9999) return json({ error: "💎 수가 맞지 않아요" }, 400);
  // 기부 적립은 무슨 장비인지 있어야 한다 (제작자 요청 2026-11-02: 애초에 등록이 안 되게)
  if (reason === "donate" && (!note || delta < 0)) return json({ error: "기부한 장비를 적어 주세요" }, 400);
  const now = await mileageOfName(env, who);
  if (now + delta < 0) return json({ error: `마일리지가 모자라요 (지금 💎${now})` }, 400);
  await env.DB.prepare("INSERT INTO rental_mileage (who, delta, reason, note, by_user, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(who, delta, reason, note || null, me.id, Date.now())
    .run();
  await notify(env, [who], "rent", `마일리지 💎${delta > 0 ? "+" : ""}${delta}${note ? ` (${note})` : ""} · 지금 💎${now + delta}`, "#/rent?v=apps", me.id);
  return json({ ok: true, mileage: now + delta });
};
