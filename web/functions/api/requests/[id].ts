// PATCH  /api/requests/:id { action } -> 의뢰 진행
//   accept  수락 (모집 중인 남의 의뢰, 선착순 한 명. 모아 둔 다음 누른다)
//   giveup  수락한 사람이 포기 -> 다시 모집 중
//   release 의뢰한 사람이 수락을 취소 -> 다시 모집 중
//   done    의뢰한 사람이 완료 (게임에서 거래를 마쳤을 때)
//   reopen  의뢰한 사람이 끝난 의뢰를 다시 모집
// DELETE /api/requests/:id -> 의뢰 내리기 (의뢰한 사람, 또는 오피서 이상)
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, paramId, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { MAX_OPEN_REQUESTS, requestOut, tidyRequests } from "../../../server/requests";
import type { RequestRow } from "../../../server/requests";

async function find(env: Env, params: Record<string, string | string[]>) {
  const id = Number(paramId(params));
  if (!Number.isInteger(id)) return null;
  return env.DB.prepare("SELECT * FROM requests WHERE id = ?").bind(id).first<RequestRow>();
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const now = Date.now();
  await env.DB.batch(tidyRequests(env.DB, now));
  const row = await find(env, params);
  if (!row) return json({ error: "없는 의뢰예요" }, 404);
  const { action } = await readJson<{ action: string }>(request);
  const owner = row.owner === me.id;
  let sql: string;
  let args: unknown[];
  if (action === "accept") {
    if (owner) return json({ error: "내 의뢰예요" }, 400);
    // 선착순: 아직 모집 중일 때만 바뀐다
    sql = "UPDATE requests SET status = 'accepted', accepter = ?, accepted_at = ?, updated_at = ? WHERE id = ? AND status = 'open' RETURNING *";
    args = [me.id, now, now, row.id];
  } else if (action === "giveup") {
    if (row.accepter !== me.id) return FORBIDDEN();
    sql = "UPDATE requests SET status = 'open', accepter = NULL, accepted_at = NULL, updated_at = ? WHERE id = ? AND status = 'accepted' AND accepter = ? RETURNING *";
    args = [now, row.id, me.id];
  } else if (action === "release") {
    if (!owner) return FORBIDDEN();
    sql = "UPDATE requests SET status = 'open', accepter = NULL, accepted_at = NULL, updated_at = ? WHERE id = ? AND status = 'accepted' RETURNING *";
    args = [now, row.id];
  } else if (action === "done") {
    if (!owner) return FORBIDDEN();
    sql = "UPDATE requests SET status = 'done', updated_at = ? WHERE id = ? AND status != 'done' RETURNING *";
    args = [now, row.id];
  } else if (action === "reopen") {
    if (!owner) return FORBIDDEN();
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE owner = ? AND status != 'done'")
      .bind(me.id)
      .first<{ n: number }>();
    if ((open?.n ?? 0) >= MAX_OPEN_REQUESTS) return json({ error: `의뢰는 한 사람이 ${MAX_OPEN_REQUESTS}개까지예요` }, 409);
    sql = "UPDATE requests SET status = 'open', accepter = NULL, accepted_at = NULL, updated_at = ? WHERE id = ? AND status = 'done' RETURNING *";
    args = [now, row.id];
  } else {
    return json({ error: "할 일이 맞지 않아요" }, 400);
  }
  const updated = await env.DB.prepare(sql).bind(...args).first<RequestRow>();
  if (!updated) {
    if (action === "accept") return json({ error: row.status === "done" ? "끝난 의뢰예요" : "이미 다른 길드원이 수락했어요" }, 409);
    return json({ error: "지금 상태에서는 할 수 없어요" }, 409);
  }
  return json(requestOut(updated));
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await find(env, params);
  if (!row) return json({ error: "없는 의뢰예요" }, 404);
  if (row.owner !== me.id && RANK[me.role] < 1) return FORBIDDEN();
  await env.DB.prepare("DELETE FROM requests WHERE id = ?").bind(row.id).run();
  return json({ ok: true });
};
