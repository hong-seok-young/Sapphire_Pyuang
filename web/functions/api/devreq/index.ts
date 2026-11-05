// GET /api/devreq -> { list, role, turn } : 개발 요청 모두 (결재 이력, 대화 수까지). turn 은 내가 결재할 차례인 요청 수
// POST /api/devreq { body, scope, people? } -> 새 요청 (앱개발자에게 알림). server/devreq.ts
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { MAX_BODY, canUseDevReq, readBody, readScope, roleOf, shortOf, tell } from "../../../server/devreq";
import type { DevReqRow } from "../../../server/devreq";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDevReq(me)) return FORBIDDEN();
  const [rows, steps, talk] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM dev_requests ORDER BY updated_at DESC LIMIT 300"),
    env.DB.prepare(
      "SELECT s.req_id, s.round, s.user_id, s.kind, s.note, s.created_at FROM dev_request_steps s " +
        "WHERE s.req_id IN (SELECT id FROM dev_requests ORDER BY updated_at DESC LIMIT 300) ORDER BY s.id",
    ),
    env.DB.prepare("SELECT req_id, COUNT(*) AS n FROM dev_request_talk GROUP BY req_id"),
  ]);
  const byReq = new Map<number, unknown[]>();
  for (const s of steps.results as { req_id: number }[]) {
    const list = byReq.get(s.req_id) ?? [];
    list.push(s);
    byReq.set(s.req_id, list);
  }
  const talks = new Map((talk.results as { req_id: number; n: number }[]).map((t) => [t.req_id, t.n]));
  const list = (rows.results as unknown as DevReqRow[]).map((r) => ({
    ...r,
    people: r.people ? (JSON.parse(r.people) as string[]) : [],
    steps: byReq.get(r.id) ?? [],
    talk: talks.get(r.id) ?? 0,
  }));
  return json({ list, role: roleOf(me) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDevReq(me)) return FORBIDDEN();
  const b = await readJson<{ body: unknown; scope: unknown; people: unknown }>(request);
  const body = readBody(b.body);
  if (!body) return json({ error: `무엇이 필요한지 ${MAX_BODY}자 안으로 적어 주세요` }, 400);
  const scope = readScope(b);
  if (typeof scope === "string") return json({ error: scope }, 400);
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM dev_requests WHERE user_id = ? AND status IN ('review', 'agree', 'rejected')")
    .bind(me.id)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= 20) return json({ error: "결재가 끝나지 않은 요청은 20개까지예요" }, 409);
  const now = Date.now();
  const row = await env.DB.prepare(
    "INSERT INTO dev_requests (user_id, body, scope, people, status, round, created_at, updated_at) VALUES (?, ?, ?, ?, 'review', 1, ?, ?) RETURNING *",
  )
    .bind(me.id, body, scope.scope, scope.people.length ? JSON.stringify(scope.people) : null, now, now)
    .first<DevReqRow>();
  await env.DB.prepare("INSERT INTO dev_request_steps (req_id, round, user_id, kind, note, created_at) VALUES (?, 1, ?, 'submit', NULL, ?)")
    .bind(row!.id, me.id, now)
    .run();
  await tell(env, me, ["developer"], row!, `개발 요청이 들어왔어요 · ${me.id}: “${shortOf(body)}”`);
  return json({ id: row!.id }, 201);
};
