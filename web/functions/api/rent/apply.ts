// POST /api/rent/apply { items: [무기 번호…], note } -> 대여 신청서 (제작자 요청 2026-11-02: 한 번에 여러 개, 운영진이 무기마다 수락·거절)
// 무기마다 선착순으로 줄을 선다 (앞사람이 받은 날 + 기한 뒤에 받는다, 화면이 신청 전에 알려 준다). 한 신청서에 5개, 한 사람이 동시에 10개까지.
// 운영진에게 알림, 지금 그 무기를 쓰는 사람에게는 첫 줄이 생기면 '기한이 끝나는 날 담당자에게 돌려주세요' 알림
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import { MAX_APP_ITEMS, MAX_WAIT, TERM_DAYS, canEnter, itemLabel, notifyManagers } from "../../../server/rental";
import type { RentalRow } from "../../../server/rental";

const md = (ms: number) => {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me)) return FORBIDDEN();
  const owner = me.owner ?? me.id;
  const b = await readJson<{ items: unknown; note: unknown }>(request);
  const ids = [...new Set(Array.isArray(b.items) ? b.items.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [])];
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 200) : "";
  if (!ids.length) return json({ error: "신청할 무기를 골라 주세요" }, 400);
  if (ids.length > MAX_APP_ITEMS) return json({ error: `한 번에 ${MAX_APP_ITEMS}개까지 신청할 수 있어요` }, 400);

  const marks = ids.map(() => "?").join(",");
  const [itemsR, charsR, activeR, queueR] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM rental_items WHERE status = 'open' AND id IN (${marks})`).bind(...ids),
    env.DB.prepare("SELECT id FROM users WHERE id = ?1 OR main_id = ?1").bind(owner),
    env.DB.prepare("SELECT item_id FROM rental_requests WHERE status IN ('wait', 'ok') AND user_id IN (SELECT id FROM users WHERE id = ?1 OR main_id = ?1)").bind(owner),
    env.DB.prepare(`SELECT item_id, COUNT(*) AS n FROM rental_requests WHERE status IN ('wait', 'ok') AND item_id IN (${marks}) GROUP BY item_id`).bind(...ids),
  ]);
  const items = itemsR.results as RentalRow[];
  if (items.length !== ids.length) return json({ error: "목록에 없는 무기가 있어요. 새로고침해 주세요" }, 404);
  const mine = new Set((charsR.results as { id: string }[]).map((r) => r.id));
  const active = new Set((activeR.results as { item_id: number }[]).map((r) => r.item_id));
  const held = items.find((i) => i.renter && mine.has(i.renter));
  if (held) return json({ error: `${itemLabel(held)} 은 지금 쓰고 있어요` }, 400);
  const dup = items.find((i) => active.has(i.id));
  if (dup) return json({ error: `${itemLabel(dup)} 은 이미 신청했어요` }, 409);
  if (active.size + items.length > MAX_WAIT) return json({ error: `신청은 한 사람이 ${MAX_WAIT}개까지 기다릴 수 있어요` }, 400);
  const queued = new Map((queueR.results as { item_id: number; n: number }[]).map((r) => [r.item_id, r.n]));

  const now = Date.now();
  const app = await env.DB.prepare("INSERT INTO rental_apps (user_id, note, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(me.id, note || null, now, now).run();
  const appId = Number(app.meta.last_row_id);
  await env.DB.batch(
    items.map((i) =>
      env.DB.prepare("INSERT INTO rental_requests (item_id, user_id, use_dia, status, created_at, app_id) VALUES (?, ?, 0, 'wait', ?, ?)").bind(i.id, me.id, now, appId),
    ),
  );

  const names = items.map(itemLabel);
  await notifyManagers(env, `대여 신청: ${me.id} · ${names[0]}${names.length > 1 ? ` 외 ${names.length - 1}개` : ""}${note ? ` · ${note}` : ""}`, me.id);
  // 지금 쓰는 사람에게: 첫 줄이 생겼으면 기한이 끝나는 날 돌려달라고 (기한 없는 무기는 반납할 때까지 쓴다)
  for (const i of items) {
    const days = TERM_DAYS[i.term];
    if (!i.renter || !i.rented_at || !days || queued.get(i.id)) continue;
    const due = i.rented_at + days * 86_400_000;
    await notify(env, [i.renter], "rent", `${itemLabel(i)} 다음 신청이 있어요 · ${due > now ? `${md(due)}에` : "지금"} 대여 담당자에게 돌려주세요`, "#/rent", me.id);
  }
  return json({ appId });
};
