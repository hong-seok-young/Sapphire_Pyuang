// GET /api/rent/log -> 장비대여 기록 (운영진, 제작자 요청 2026-11-02: '운영 오른쪽에 기록, 누가 언제 대여하고 반납했는지 다 남겨'):
//   건넨(대여 완료·대여 등록) 줄마다 무기, 빌린 사람, 대여한 때, 반납한 때(대여 중이면 null), 건넨 사람, 보증금. 최근 300개
// DELETE /api/rent/log?id=N -> 기록 한 줄 지우기 (운영진, 제작자 요청: 시험으로 남긴 기록을 지우게). 지금 대여 중인 줄은 반납한 뒤에 지운다
//   (지우면 그 무기를 빌린 사람과 기한이 어긋난다). 사람이 직접 지우는 것이라 CLAUDE.md '기록은 평생'과 맞다
import { FORBIDDEN, NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canEnter, isManager } from "../../../server/rental";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me) || !isManager(me)) return FORBIDDEN();
  const { results } = await env.DB.prepare(
    "SELECT r.id AS id, r.item_id AS itemId, i.weapon AS weapon, i.enhance AS enhance, i.job AS job, i.status AS itemStatus, r.user_id AS user, " +
      "r.done_at AS rentedAt, r.returned_at AS returnedAt, r.done_by AS by, r.use_dia AS useDia, r.gold AS gold " +
      "FROM rental_requests r LEFT JOIN rental_items i ON i.id = r.item_id WHERE r.status = 'done' ORDER BY r.done_at DESC LIMIT 300",
  ).all();
  return json({ log: results }, 200, { "cache-control": "no-store" });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me) || !isManager(me)) return FORBIDDEN();
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return json({ error: "잘못된 요청이에요" }, 400);
  const row = await env.DB.prepare("SELECT status, returned_at FROM rental_requests WHERE id = ?").bind(id).first<{ status: string; returned_at: number | null }>();
  if (!row) return json({ error: "없는 기록이에요" }, 404);
  if (row.status === "done" && row.returned_at === null) return json({ error: "대여 중인 기록은 반납한 뒤에 지워요" }, 400);
  await env.DB.prepare("DELETE FROM rental_requests WHERE id = ?").bind(id).run();
  return json({ ok: true });
};
