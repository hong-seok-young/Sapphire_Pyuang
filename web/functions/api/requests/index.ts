// GET  /api/requests -> 길드원 의뢰소: 모집 중, 진행 중, 끝난(30일 안, 그 전 것도 지우지 않고 둔다) 의뢰 전부. 수락하고 이틀 지난 것은 먼저 다시 모집 중으로
// POST /api/requests { title, detail?, rewardGold? | rewardText? } -> 의뢰 올리기 (보상은 골드나 글 중 하나)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import type { Env } from "../../../server/auth";
import { MAX_OPEN_REQUESTS, SHOW_DONE_MS, readRequest, requestOut, tidyRequests } from "../../../server/requests";
import type { RequestRow } from "../../../server/requests";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const now = Date.now();
  await env.DB.batch(tidyRequests(env.DB, now));
  const { results } = await env.DB.prepare("SELECT * FROM requests WHERE status != 'done' OR updated_at >= ? ORDER BY created_at DESC")
    .bind(now - SHOW_DONE_MS)
    .all<RequestRow>();
  return json({ requests: results.map(requestOut) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const input = readRequest(await readJson<Record<string, unknown>>(request));
  if (typeof input === "string") return json({ error: input }, 400);
  const now = Date.now();
  await env.DB.batch(tidyRequests(env.DB, now));
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE owner = ? AND status != 'done'")
    .bind(me.id)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_REQUESTS) return json({ error: `의뢰는 한 사람이 ${MAX_OPEN_REQUESTS}개까지예요. 끝난 의뢰는 '완료'를 눌러 주세요` }, 409);
  const row = await env.DB.prepare(
    "INSERT INTO requests (owner, title, detail, reward_gold, reward_text, status, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, 'open', ?, ?) RETURNING *",
  )
    .bind(me.id, input.title, input.detail, input.rewardGold, input.rewardText, now, now)
    .first<RequestRow>();
  if (!row) return json({ error: "올리지 못했어요" }, 500);
  await notify(env, "all", "request_new", `${me.id}님의 새 의뢰 “${row.title}”`, "#/requests", me.id);
  return json(requestOut(row), 201);
};
