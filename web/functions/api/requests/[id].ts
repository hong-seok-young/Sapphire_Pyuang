// PATCH  /api/requests/:id { action, note? } -> 의뢰 진행
//   accept  수락 (모집 중인 남의 의뢰, 한마디 note 에 '저 20개 있어요' 같은 것을 자유롭게. 여러 사람이 할 수 있고 한 사람은 한 번)
//   giveup  수락한 사람이 포기
//   done    의뢰한 사람이 완료 (게임에서 거래를 마쳤거나 함께 했을 때. 수락한 사람들에게 알림)
//   reopen  의뢰한 사람이 끝난 의뢰를 다시 모집
// DELETE /api/requests/:id -> 의뢰 내리기 (의뢰한 사람, 또는 오피서 이상). 수락 줄도 같이 지운다
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, paramId, readJson } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import type { Env } from "../../../server/auth";
import { MAX_NOTE, MAX_OFFERS, MAX_OPEN_REQUESTS, offersOf, requestOut, text } from "../../../server/requests";
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
  const row = await find(env, params);
  if (!row) return json({ error: "없는 의뢰예요" }, 404);
  const body = await readJson<{ action: string; note: unknown }>(request);
  const action = body.action;
  const owner = row.owner === me.id;
  const done = row.status === "done";
  const offers = await offersOf(env.DB, [row.id]);
  const live = offers.filter((o) => o.status === "pledged");
  const title = `의뢰 “${row.title}”`;
  /** 바뀐 뒤 의뢰 한 줄을 다시 읽어 준다 */
  const out = async () => {
    const fresh = (await env.DB.prepare("SELECT * FROM requests WHERE id = ?").bind(row.id).first<RequestRow>()) ?? row;
    return json(requestOut(fresh, await offersOf(env.DB, [row.id])));
  };

  if (action === "accept") {
    if (owner) return json({ error: "내 의뢰예요" }, 400);
    if (done) return json({ error: "끝난 의뢰예요" }, 409);
    if (live.some((o) => o.user_id === me.id)) return json({ error: "이미 수락했어요" }, 409);
    if (live.length >= MAX_OFFERS) return json({ error: "수락한 사람이 너무 많아요" }, 409);
    const note = text(body.note, MAX_NOTE);
    if (note === undefined) return json({ error: `한마디는 ${MAX_NOTE}자까지예요` }, 400);
    // 두 번 눌러도 한 줄만: 살아 있는 내 수락이 없을 때만 넣는다
    const ins = await env.DB.prepare(
      "INSERT INTO request_offers (request_id, user_id, note, status, created_at, updated_at) SELECT ?1, ?2, ?3, 'pledged', ?4, ?4 " +
        "WHERE NOT EXISTS (SELECT 1 FROM request_offers o WHERE o.request_id = ?1 AND o.user_id = ?2 AND o.status = 'pledged')",
    )
      .bind(row.id, me.id, note, now)
      .run();
    if (!ins.meta.changes) return json({ error: "이미 수락했어요" }, 409);
    await env.DB.prepare("UPDATE requests SET updated_at = ? WHERE id = ?").bind(now, row.id).run();
    await notify(env, [row.owner], "request", `${me.id}님이 ${title} 수락${note ? ` · “${note}”` : ""}`, "#/requests", me.id);
    return out();
  }

  if (action === "giveup") {
    const o = live.find((x) => x.user_id === me.id);
    if (!o) return json({ error: "포기할 수락이 없어요" }, 409);
    await env.DB.batch([
      env.DB.prepare("UPDATE request_offers SET status = 'giveup', updated_at = ? WHERE id = ?").bind(now, o.id),
      env.DB.prepare("UPDATE requests SET updated_at = ? WHERE id = ?").bind(now, row.id),
    ]);
    await notify(env, [row.owner], "request", `${me.id}님이 ${title} 수락 포기`, "#/requests", me.id);
    return out();
  }

  if (action === "done") {
    if (!owner) return FORBIDDEN();
    if (done) return json({ error: "이미 끝난 의뢰예요" }, 409);
    await env.DB.prepare("UPDATE requests SET status = 'done', updated_at = ? WHERE id = ?").bind(now, row.id).run();
    await notify(env, [...new Set(live.map((o) => o.user_id))], "request", `${title} 완료`, "#/requests", me.id);
    return out();
  }

  if (action === "reopen") {
    if (!owner) return FORBIDDEN();
    if (!done) return json({ error: "끝난 의뢰가 아니에요" }, 409);
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE owner = ? AND status != 'done'")
      .bind(me.id)
      .first<{ n: number }>();
    if ((open?.n ?? 0) >= MAX_OPEN_REQUESTS) return json({ error: `의뢰는 한 사람이 ${MAX_OPEN_REQUESTS}개까지예요` }, 409);
    await env.DB.prepare("UPDATE requests SET status = 'open', updated_at = ? WHERE id = ? AND status = 'done'").bind(now, row.id).run();
    return out();
  }

  return json({ error: "할 일이 맞지 않아요" }, 400);
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const row = await find(env, params);
  if (!row) return json({ error: "없는 의뢰예요" }, 404);
  if (row.owner !== me.id && RANK[me.role] < 1) return FORBIDDEN();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM request_offers WHERE request_id = ?").bind(row.id),
    env.DB.prepare("DELETE FROM requests WHERE id = ?").bind(row.id),
  ]);
  return json({ ok: true });
};
