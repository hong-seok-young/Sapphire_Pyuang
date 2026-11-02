// GET /api/rent -> 장비대여 목록(무기마다 쓰는 사람, 줄, 새로 신청하면 받을 수 있는 때), 신청서(대화 포함), 내 마일리지와 장부
//   길드원: 내 신청서 최근 10개. 운영진: 줄 서는 신청이 있는 신청서 모두와 무기마다 줄 명단, 사람마다 마일리지, 닉네임 목록
// POST /api/rent { job, level, weapon, options, enhance, term, price, donor, donorDia, note } -> 물건 더하기 (운영진). donorDia: 기부자에게 적립할 💎 (server/rental.ts setDonation)
// 제작자 요청 2026-11-01, 신청서·줄·대화창 2026-11-02. 지금은 개발 중이라 앱개발자만 (server/rental.ts RENT_OPEN)
import { FORBIDDEN, NEED_LOGIN, TEST_IDS, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { DIA_GOLD, TERM_DAYS, canEnter, checkItem, donations, donorDiaOf, expectedTimes, isManager, mileageOf, setDonation } from "../../../server/rental";
import type { QueueRow, RentalRow } from "../../../server/rental";

interface ReqRow {
  id: number;
  item_id: number;
  user_id: string;
  status: string;
  created_at: number;
  done_at: number | null;
  returned_at: number | null;
  app_id: number | null;
  use_dia: number;
}
interface AppRow {
  id: number;
  user_id: string;
  note: string | null;
  created_at: number;
  updated_at: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me)) return FORBIDDEN();
  const manager = isManager(me);
  const owner = me.owner ?? me.id;
  const now = Date.now();
  const [itemsR, queueR, depositR, charsR, ledgerR, myAppsR] = await env.DB.batch([
    env.DB.prepare(
      "SELECT id, job, level, weapon, options, enhance, term, price, donor, renter, rented_at, due_at, note FROM rental_items WHERE status = 'open' ORDER BY job, level, weapon, enhance, id",
    ),
    env.DB.prepare("SELECT id, item_id, user_id, status, created_at, app_id FROM rental_requests WHERE status IN ('wait', 'ok') ORDER BY created_at, id"),
    // 지금 대여 중인 무기마다 받은 보증금 (가장 최근의 반납 전 대여)
    env.DB.prepare(
      "SELECT r.item_id, r.use_dia, r.gold FROM rental_requests r JOIN rental_items i ON i.id = r.item_id AND i.renter IS NOT NULL " +
        "WHERE r.status = 'done' AND r.returned_at IS NULL ORDER BY r.done_at",
    ),
    env.DB.prepare("SELECT id FROM users WHERE id = ?1 OR main_id = ?1").bind(owner),
    env.DB.prepare(
      "SELECT who, delta, gold, reason, note, created_at AS at FROM rental_mileage WHERE who IN (SELECT id FROM users WHERE id = ?1 OR main_id = ?1) " +
        "ORDER BY created_at DESC LIMIT 30",
    ).bind(owner),
    env.DB.prepare("SELECT id, user_id, note, created_at, updated_at FROM rental_apps WHERE user_id IN (SELECT id FROM users WHERE id = ?1 OR main_id = ?1) ORDER BY created_at DESC LIMIT 10").bind(owner),
  ]);
  const mine = new Set((charsR.results as { id: string }[]).map((r) => r.id));
  const deposits = new Map<number, { dia: number; gold: number | null }>();
  for (const d of depositR.results as { item_id: number; use_dia: number; gold: number | null }[]) deposits.set(d.item_id, { dia: d.use_dia, gold: d.gold });
  const rows = itemsR.results as RentalRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  // 무기마다 줄 (신청한 순서)과 차례마다 받을 수 있는 때
  const lines = new Map<number, QueueRow[]>();
  for (const q of queueR.results as QueueRow[]) lines.set(q.item_id, [...(lines.get(q.item_id) ?? []), q]);
  const when = new Map<number, (number | null)[]>();
  for (const r of rows) when.set(r.id, expectedTimes(r, (lines.get(r.id)?.length ?? 0) + 1, now));
  /** 그 신청의 차례(1부터)와 받을 수 있는 때 */
  const placeOf = (q: { id: number; item_id: number }) => {
    const line = lines.get(q.item_id) ?? [];
    const i = line.findIndex((x) => x.id === q.id);
    return i < 0 ? null : { pos: i + 1, at: when.get(q.item_id)?.[i] ?? null };
  };

  // 운영진: 물건마다 기부자에게 적립한 💎 (물건 고치기 칸에 채운다)
  const donated = manager ? await donations(env) : new Map<number, Map<string, number>>();
  const items = rows.map((it) => {
    const line = lines.get(it.id) ?? [];
    const my = line.find((q) => mine.has(q.user_id));
    const days = TERM_DAYS[it.term];
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
      note: it.note,
      renter: it.renter,
      rentedAt: it.rented_at,
      // 기한이 끝나는 날 (줄이 있으면 이날 담당자에게 돌려준다)
      dueAt: it.renter && it.rented_at && days ? it.rented_at + days * 86_400_000 : null,
      queue: line.length,
      // 지금 새로 신청하면 받을 수 있는 때 (null 은 앞사람이 반납하면)
      next: when.get(it.id)?.[line.length] ?? null,
      mine: my ? { rid: my.id, status: my.status, ...placeOf(my)! } : null,
      ...(manager ? { donorDia: it.donor ? (donated.get(it.id)?.get(it.donor) ?? 0) : 0 } : {}),
      // 받은 보증금: 운영진과 빌린 사람에게만 (예전 기록에 골드가 없으면 가격에서 마일리지를 뺀 나머지)
      ...(it.renter && (manager || mine.has(it.renter))
        ? (() => {
            const d = deposits.get(it.id) ?? { dia: 0, gold: null };
            return { deposit: { dia: d.dia, gold: d.gold ?? (it.price - d.dia) * DIA_GOLD } };
          })()
        : {}),
      // 누가 줄을 섰는지는 운영진만 (길드원은 수와 내 차례만)
      ...(manager ? { line: line.map((q) => ({ rid: q.id, user: q.user_id, status: q.status, appId: q.app_id, ...placeOf(q)! })) } : {}),
    };
  });

  // 신청서: 길드원은 내 것, 운영진은 줄 서는 신청이 있는 것 모두 (와 내 것)
  const openAppIds = [...new Set((queueR.results as QueueRow[]).map((q) => q.app_id).filter((a): a is number => a !== null))];
  const appIds = [...new Set([...(myAppsR.results as AppRow[]).map((a) => a.id), ...(manager ? openAppIds : [])])];
  let apps: unknown[] = [];
  if (appIds.length) {
    const marks = appIds.map(() => "?").join(",");
    const [appsR, reqsR, talkR] = await env.DB.batch([
      env.DB.prepare(`SELECT id, user_id, note, created_at, updated_at FROM rental_apps WHERE id IN (${marks})`).bind(...appIds),
      env.DB.prepare(`SELECT id, item_id, user_id, status, created_at, done_at, returned_at, app_id, use_dia FROM rental_requests WHERE app_id IN (${marks}) ORDER BY id`).bind(...appIds),
      env.DB.prepare(`SELECT id, app_id, user_id, text, created_at FROM rental_talk WHERE app_id IN (${marks}) ORDER BY id`).bind(...appIds),
    ]);
    const reqs = reqsR.results as ReqRow[];
    const talk = talkR.results as { id: number; app_id: number; user_id: string; text: string; created_at: number }[];
    // 운영진에게는 신청한 사람의 마일리지도 (건넬 때 쓸 💎 를 고르게)
    const people = manager ? [...new Set((appsR.results as AppRow[]).map((a) => a.user_id))] : [];
    const mileage = new Map<string, number>();
    for (const who of people) {
      const u = await env.DB.prepare("SELECT COALESCE(main_id, id) AS owner FROM users WHERE id = ?").bind(who).first<{ owner: string }>();
      mileage.set(who, await mileageOf(env, u?.owner ?? who));
    }
    apps = (appsR.results as AppRow[])
      .sort((a, b) => b.updated_at - a.updated_at)
      .map((a) => ({
        id: a.id,
        user: a.user_id,
        note: a.note,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        mine: mine.has(a.user_id),
        ...(manager ? { mileage: mileage.get(a.user_id) ?? 0 } : {}),
        requests: reqs
          .filter((r) => r.app_id === a.id)
          .map((r) => {
            const it = byId.get(r.item_id);
            return {
              rid: r.id,
              itemId: r.item_id,
              weapon: it?.weapon ?? null,
              enhance: it?.enhance ?? null,
              term: it?.term ?? null,
              price: it?.price ?? null,
              status: r.status,
              doneAt: r.done_at,
              returnedAt: r.returned_at,
              useDia: r.use_dia,
              // 지금 그 무기를 이 사람이 쓰고 있는지
              holding: r.status === "done" && !r.returned_at && it?.renter === r.user_id,
              ...(r.status === "wait" || r.status === "ok" ? placeOf(r) ?? {} : {}),
            };
          }),
        talk: talk.filter((t) => t.app_id === a.id).slice(-50).map((t) => ({ id: t.id, user: t.user_id, text: t.text, at: t.created_at })),
      }));
  }

  const out: Record<string, unknown> = {
    items,
    apps,
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
        // 기부 현황 (제작자 요청 2026-11-02: 운영 '기부 현황'): 남은 💎, 기부로 적립한 💎, 기부 건수 (물건으로 적립한 것은 물건마다 한 번, 손으로 적립한 것은 줄마다)
        "SELECT COALESCE(u.main_id, u.id, m.who) AS person, SUM(m.delta) AS dia, MAX(m.created_at) AS at, " +
          "SUM(CASE WHEN m.reason = 'donate' THEN m.delta ELSE 0 END) AS donated, " +
          "COUNT(DISTINCT CASE WHEN m.reason = 'donate' AND m.item_id IS NOT NULL THEN m.item_id END) + SUM(m.reason = 'donate' AND m.item_id IS NULL AND m.delta > 0) AS count " +
          "FROM rental_mileage m LEFT JOIN users u ON u.id = m.who GROUP BY person ORDER BY donated DESC, dia DESC",
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
  const body = await readJson<Record<string, unknown>>(request);
  const checked = checkItem(body);
  if ("error" in checked) return json({ error: checked.error }, 400);
  const it = checked.item;
  const dia = donorDiaOf(body);
  if (dia === null) return json({ error: "기부 💎 가 맞지 않아요" }, 400);
  if (dia > 0 && !it.donor) return json({ error: "기부한 사람을 적어 주세요" }, 400);
  const now = Date.now();
  const r = await env.DB.prepare(
    "INSERT INTO rental_items (job, level, weapon, options, enhance, term, price, donor, note, status, created_at, updated_at, updated_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)",
  )
    .bind(it.job, it.level, it.weapon, it.options, it.enhance, it.term, it.price, it.donor, it.note, now, now, me.id)
    .run();
  const id = Number(r.meta.last_row_id);
  const err = dia > 0 ? await setDonation(env, { id, weapon: it.weapon, enhance: it.enhance }, it.donor, dia, me.id) : null;
  return json({ id, ...(err ? { warning: err } : {}) });
};
