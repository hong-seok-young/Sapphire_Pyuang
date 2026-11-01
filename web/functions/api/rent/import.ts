// POST /api/rent/import { text, apply } -> 카카오톡 대여무기 목록 글을 그대로 붙여 넣어 목록을 맞춘다 (운영진, 제작자 요청 2026-11-01)
// apply 가 아니면 미리 보기만: 직업마다 새로 들어올 것, 그대로인 것, 내려갈 것의 수와 읽지 못한 줄.
// 맞추기: 글에 나온 직업만, 같은 기한·무기·옵션·강화·기부자의 물건은 그대로 두고 가격과 레벨만 고친다. 글에 없는 물건은 내리고(status 'gone',
// 기다리던 신청은 거절), 새 물건은 더한다. 🆙 가 붙은 줄은 대여 중으로 (앱에서 대여 중인 물건은 글에 🆙 가 없어도 그대로 둔다: 반납은 앱에서)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canEnter, dueOf, isManager } from "../../../server/rental";
import type { RentalRow } from "../../../server/rental";
import { parseRentalList } from "../../../server/rentalParse";
import type { ParsedRental, RentJob } from "../../../server/rentalParse";

const keyOf = (r: { term: string; weapon: string; options: string; enhance: number; donor: string | null }) =>
  [r.term, r.weapon.replace(/\s+/g, ""), r.options, r.enhance, r.donor ?? ""].join("|");

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canEnter(me) || !isManager(me)) return FORBIDDEN();
  const b = await readJson<{ text: unknown; apply: unknown }>(request);
  const text = typeof b.text === "string" ? b.text.slice(0, 50_000) : "";
  const parsed = parseRentalList(text);
  if (!parsed.items.length) return json({ error: "목록에서 물건을 읽지 못했어요. 카톡 목록 글을 머리('[sapphire 대여무기 목록] 전사')부터 붙여 넣어 주세요", skipped: parsed.skipped }, 400);

  const jobs = [...new Set(parsed.items.map((i) => i.job))] as RentJob[];
  const { results: existing } = await env.DB.prepare(
    `SELECT * FROM rental_items WHERE status = 'open' AND job IN (${jobs.map(() => "?").join(",")})`,
  )
    .bind(...jobs)
    .all<RentalRow>();
  // 같은 물건이 두 개면 하나씩 짝짓는다
  const pool = new Map<string, RentalRow[]>();
  for (const e of existing) pool.set(keyOf(e), [...(pool.get(keyOf(e)) ?? []), e]);
  const keep: { row: RentalRow; next: ParsedRental }[] = [];
  const add: ParsedRental[] = [];
  for (const p of parsed.items) {
    const hit = pool.get(keyOf(p))?.shift();
    if (hit) keep.push({ row: hit, next: p });
    else add.push(p);
  }
  const gone = [...pool.values()].flat();
  const summary = {
    jobs,
    add: add.length,
    keep: keep.length,
    gone: gone.length,
    goneRented: gone.filter((g) => g.renter).length,
    skipped: parsed.skipped,
  };
  if (b.apply !== true) return json(summary);
  if (summary.goneRented) return json({ error: "대여 중인 물건이 글에 없어요. 먼저 반납하거나 글에 넣어 주세요", ...summary }, 400);

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const p of add) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO rental_items (job, level, weapon, options, enhance, term, price, donor, renter, rented_at, due_at, status, created_at, updated_at, updated_by) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)",
      ).bind(p.job, p.level, p.weapon, p.options, p.enhance, p.term, p.price, p.donor, p.renter, p.renter ? p.rentedAt ?? now : null, p.renter ? dueOf(p.term, p.rentedAt ?? now) : null, now, now, me.id),
    );
    // 대여 중이면 대여 기록도 (방금 넣은 물건)
    if (p.renter) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO rental_requests (item_id, user_id, use_dia, status, created_at, done_at, done_by) VALUES (last_insert_rowid(), ?, 0, 'done', ?, ?, ?)",
        ).bind(p.renter, p.rentedAt ?? now, p.rentedAt ?? now, me.id),
      );
    }
  }
  for (const { row, next } of keep) {
    const lend = next.renter && !row.renter;
    stmts.push(
      env.DB.prepare(
        "UPDATE rental_items SET level = ?, price = ?, renter = COALESCE(renter, ?), rented_at = COALESCE(rented_at, ?), due_at = CASE WHEN renter IS NULL THEN ? ELSE due_at END, " +
          "updated_at = ?, updated_by = ? WHERE id = ?",
      ).bind(next.level, next.price, lend ? next.renter : null, lend ? next.rentedAt ?? now : null, lend ? dueOf(next.term, next.rentedAt ?? now) : null, now, me.id, row.id),
    );
    if (lend) {
      stmts.push(
        env.DB.prepare("INSERT INTO rental_requests (item_id, user_id, use_dia, status, created_at, done_at, done_by) VALUES (?, ?, 0, 'done', ?, ?, ?)").bind(
          row.id, next.renter, next.rentedAt ?? now, next.rentedAt ?? now, me.id,
        ),
      );
    }
  }
  for (const g of gone) {
    stmts.push(env.DB.prepare("UPDATE rental_items SET status = 'gone', updated_at = ?, updated_by = ? WHERE id = ?").bind(now, me.id, g.id));
    stmts.push(env.DB.prepare("UPDATE rental_requests SET status = 'no', done_at = ?, done_by = ? WHERE item_id = ? AND status IN ('wait', 'ok')").bind(now, me.id, g.id));
  }
  // 한 번에 너무 많이 보내지 않게 나눠서
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return json({ ...summary, applied: true });
};
