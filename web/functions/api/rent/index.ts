// GET /api/rent -> 장비대여 목록, 내 마일리지와 장부, 내 신청 (운영진은 신청 명단, 사람마다 마일리지, 닉네임 목록도)
// POST /api/rent { job, level, weapon, options, enhance, term, price, donor, note } -> 물건 더하기 (운영진)
// 제작자 요청 2026-11-01. 지금은 개발 중이라 앱개발자만 (server/rental.ts RENT_OPEN)
import { FORBIDDEN, NEED_LOGIN, TEST_IDS, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { DIA_GOLD, canEnter, checkItem, isManager, mileageOf } from "../../../server/rental";
import type { RentalRow } from "../../../server/rental";

interface WaitRow {
  id: number;
  item_id: number;
  user_id: string;
  use_dia: number;
  note: string | null;
  created_at: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me)) return FORBIDDEN();
  const manager = isManager(me);
  const owner = me.owner ?? me.id;
  const [itemsR, waitR, charsR, ledgerR] = await env.DB.batch([
    env.DB.prepare(
      "SELECT id, job, level, weapon, options, enhance, term, price, donor, renter, rented_at, due_at, note FROM rental_items WHERE status = 'open' " +
        "ORDER BY job, level, weapon, enhance, price, id",
    ),
    env.DB.prepare("SELECT id, item_id, user_id, use_dia, note, created_at FROM rental_requests WHERE status = 'wait' ORDER BY created_at"),
    env.DB.prepare("SELECT id FROM users WHERE id = ?1 OR main_id = ?1").bind(owner),
    env.DB.prepare(
      "SELECT who, delta, gold, reason, note, created_at AS at FROM rental_mileage WHERE who IN (SELECT id FROM users WHERE id = ?1 OR main_id = ?1) " +
        "ORDER BY created_at DESC LIMIT 30",
    ).bind(owner),
  ]);
  const mine = new Set((charsR.results as { id: string }[]).map((r) => r.id));
  const waits = waitR.results as WaitRow[];
  const items = (itemsR.results as RentalRow[]).map((it) => {
    const w = waits.filter((x) => x.item_id === it.id);
    const my = w.find((x) => mine.has(x.user_id));
    return {
      id: it.id,
      job: it.job,
      level: it.level,
      weapon: it.weapon,
      options: it.options,
      enhance: it.enhance,
      term: it.term,
      price: it.price,
      donor: it.donor,
      renter: it.renter,
      rentedAt: it.rented_at,
      dueAt: it.due_at,
      note: it.note,
      waiting: w.length,
      mine: my ? { id: my.id, useDia: my.use_dia, note: my.note } : null,
      // 누가 신청했는지와 마일리지 쓸 양은 운영진만
      ...(manager ? { requests: w.map((x) => ({ id: x.id, user: x.user_id, useDia: x.use_dia, note: x.note, at: x.created_at })) } : {}),
    };
  });
  const out: Record<string, unknown> = {
    items,
    manager,
    rate: DIA_GOLD,
    mine: [...mine],
    mileage: await mileageOf(env, owner),
    ledger: ledgerR.results,
  };
  if (manager) {
    // 사람마다 마일리지 (묶은 캐릭터는 본캐 하나로, 앱에 없는 기부자는 닉네임 그대로)와 닉네임 고르기 목록
    const [balR, usersR] = await env.DB.batch([
      env.DB.prepare(
        "SELECT COALESCE(u.main_id, u.id, m.who) AS person, SUM(m.delta) AS dia, MAX(m.created_at) AS at FROM rental_mileage m " +
          "LEFT JOIN users u ON u.id = m.who GROUP BY person ORDER BY dia DESC",
      ),
      env.DB.prepare("SELECT id FROM users ORDER BY id"),
    ]);
    out.balances = balR.results;
    out.members = (usersR.results as { id: string }[]).map((r) => r.id).filter((id) => !TEST_IDS.includes(id));
  }
  return json(out, 200, { "cache-control": "no-store" });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me) || !isManager(me)) return FORBIDDEN();
  const checked = checkItem(await readJson<Record<string, unknown>>(request));
  if ("error" in checked) return json({ error: checked.error }, 400);
  const it = checked.item;
  const now = Date.now();
  const r = await env.DB.prepare(
    "INSERT INTO rental_items (job, level, weapon, options, enhance, term, price, donor, note, status, created_at, updated_at, updated_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)",
  )
    .bind(it.job, it.level, it.weapon, it.options, it.enhance, it.term, it.price, it.donor, it.note, now, now, me.id)
    .run();
  return json({ id: r.meta.last_row_id });
};
