// PUT /api/donate/:id { action, ... } (server/donate.ts)
//   confirm { gold, item?, qty?, enhance?, note? }  운영진: 신청을 그 골드 가치로 확정, 마일리지 지급
//   edit    { item, qty, enhance, note, gold }      운영진: 확인 전·확정한 줄 고치기 (확정한 줄은 마일리지를 맞춘다). 신청한 사람: 확인 전 내 신청 고치기 (gold 는 내가 적는 가치)
//   reject                                         운영진: 신청 거절
//   place   { place: keep | used }                 운영진: 받은 템을 보관 / 나눔·사용
//   rent    { undo? }                              운영진: 장비대여 운용 (장비대여 '물건 추가' 목록으로 넘긴다, undo 면 보관으로)
// DELETE /api/donate/:id  운영진: 지우기 (확정한 줄이면 그만큼 마일리지를 뺀다). 신청한 사람: 확인 전 내 신청 취소
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canManageDonate, canUseDonate, donateLabel, earnedDia, goldText, notifyDonor, readDonate, syncDia } from "../../../server/donate";
import type { DonateRow } from "../../../server/donate";
import { notifyManagers } from "../../../server/rental";

async function rowOf(env: Env, id: number) {
  return env.DB.prepare("SELECT * FROM donate_items WHERE id = ?").bind(id).first<DonateRow>();
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDonate(me)) return FORBIDDEN();
  const id = Number(params.id);
  const row = Number.isInteger(id) ? await rowOf(env, id) : null;
  if (!row || row.status === "removed") return json({ error: "없는 기부예요" }, 404);
  const manage = canManageDonate(me);
  const b = await readJson<Record<string, unknown>>(request);
  const now = Date.now();

  if (b.action === "edit") {
    const v = readDonate({ item: row.item, qty: row.qty, enhance: row.enhance, note: row.note, ...b });
    if ("error" in v) return json({ error: v.error }, 400);
    if (!manage) {
      if (row.created_by !== me.id || row.status !== "request") return FORBIDDEN();
      await env.DB.prepare("UPDATE donate_items SET item = ?, qty = ?, enhance = ?, note = ?, gold_ask = ? WHERE id = ?")
        .bind(v.item, v.qty, v.enhance, v.note, v.gold, id)
        .run();
      return json({ ok: true });
    }
    if (row.status === "rejected") return json({ error: "거절한 기부예요" }, 409);
    if (row.status === "request") {
      await env.DB.prepare("UPDATE donate_items SET item = ?, qty = ?, enhance = ?, note = ?, gold_ask = ? WHERE id = ?")
        .bind(v.item, v.qty, v.enhance, v.note, v.gold ?? row.gold_ask, id)
        .run();
      return json({ ok: true });
    }
    if (v.gold === null) return json({ error: "골드 가치를 적어 주세요" }, 400);
    await env.DB.prepare("UPDATE donate_items SET item = ?, qty = ?, enhance = ?, note = ?, gold = ? WHERE id = ?")
      .bind(v.item, v.qty, v.enhance, v.note, v.gold, id)
      .run();
    const s = await syncDia(env, row.who, id, donateLabel(v), me.id);
    if (s.error) {
      await env.DB.prepare("UPDATE donate_items SET item = ?, qty = ?, enhance = ?, note = ?, gold = ? WHERE id = ?")
        .bind(row.item, row.qty, row.enhance, row.note, row.gold, id)
        .run();
      return json({ error: s.error }, 409);
    }
    if (v.gold !== row.gold)
      await notifyDonor(env, row.who, `🎁 기부 가치 고침 · ${donateLabel(v)} ${goldText(v.gold)} 골드${s.diff ? ` · 마일리지 💎${s.diff > 0 ? "+" : ""}${s.diff}` : ""}`, me.id);
    return json({ ok: true, dia: s.diff, mileage: s.mileage });
  }

  if (!manage) return FORBIDDEN();

  if (b.action === "confirm") {
    if (row.status !== "request") return json({ error: "이미 처리한 기부예요" }, 409);
    const v = readDonate({ item: row.item, qty: row.qty, enhance: row.enhance, note: row.note, gold: row.gold_ask, ...b });
    if ("error" in v) return json({ error: v.error }, 400);
    if (v.gold === null) return json({ error: "골드 가치를 적어 주세요" }, 400);
    const r = await env.DB.prepare(
      "UPDATE donate_items SET item = ?, qty = ?, enhance = ?, note = ?, gold = ?, status = 'done', done_at = ?, done_by = ? WHERE id = ? AND status = 'request'",
    )
      .bind(v.item, v.qty, v.enhance, v.note, v.gold, now, me.id, id)
      .run();
    if (!r.meta.changes) return json({ error: "이미 처리한 기부예요" }, 409);
    const s = await syncDia(env, row.who, id, donateLabel(v), me.id);
    await notifyDonor(
      env,
      row.who,
      `🎁 기부 확정 · ${donateLabel(v)} ${goldText(v.gold)} 골드 · 마일리지 +${earnedDia(v.gold).toFixed(1)}${s.diff ? ` (쓸 수 있는 💎+${s.diff})` : ""} · 지금 💎${s.mileage}`,
      me.id,
    );
    return json({ ok: true, dia: s.diff, mileage: s.mileage });
  }

  if (b.action === "reject") {
    if (row.status !== "request") return json({ error: "이미 처리한 기부예요" }, 409);
    await env.DB.prepare("UPDATE donate_items SET status = 'rejected', done_at = ?, done_by = ? WHERE id = ?").bind(now, me.id, id).run();
    await notifyDonor(env, row.who, `🎁 기부 신청 거절 · ${donateLabel(row)}`, me.id);
    return json({ ok: true });
  }

  if (b.action === "place") {
    if (row.status !== "done") return json({ error: "확정한 기부만 돼요" }, 409);
    if (row.rental_id) return json({ error: "장비대여에 올린 물건이에요" }, 409);
    const place = b.place === "used" ? "used" : "keep";
    await env.DB.prepare("UPDATE donate_items SET place = ? WHERE id = ?").bind(place, id).run();
    return json({ ok: true });
  }

  // 장비대여 운용 (제작자 2026-11-10 '기부함에서 장비대여 운용 버튼 누르면 장비대여 쪽 리스트로'): 넘기기만 하고, 직업·레벨·기한·💎 가격은 장비대여 '물건 추가'에서 이 기부를 골라 정한다.
  // undo: 아직 장비대여에 안 올렸으면 보관으로 되돌린다
  if (b.action === "rent") {
    if (row.status !== "done") return json({ error: "확정한 기부만 돼요" }, 409);
    if (row.rental_id) return json({ error: "이미 장비대여에 올렸어요" }, 409);
    if (b.undo === true) {
      await env.DB.prepare("UPDATE donate_items SET place = 'keep' WHERE id = ? AND rental_id IS NULL").bind(id).run();
      return json({ ok: true });
    }
    if (row.place === "rent") return json({ error: "이미 장비대여로 넘겼어요" }, 409);
    await env.DB.prepare("UPDATE donate_items SET place = 'rent' WHERE id = ?").bind(id).run();
    await notifyManagers(env, `🎁 기부함에서 장비대여로 · ${donateLabel(row)} (기부 ${row.who}) · 물건 추가에서 올려 주세요`, me.id);
    return json({ ok: true });
  }

  return json({ error: "잘못된 요청이에요" }, 400);
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseDonate(me)) return FORBIDDEN();
  const id = Number(params.id);
  const row = Number.isInteger(id) ? await rowOf(env, id) : null;
  if (!row || row.status === "removed") return json({ error: "없는 기부예요" }, 404);
  if (!canManageDonate(me)) {
    if (row.created_by !== me.id || row.status !== "request") return FORBIDDEN();
    await env.DB.prepare("DELETE FROM donate_items WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  if (row.status !== "done") {
    await env.DB.prepare("DELETE FROM donate_items WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  // 확정한 줄: 지운 것으로 두고(장부와 dia 를 맞추려고) 그만큼 마일리지를 뺀다
  await env.DB.prepare("UPDATE donate_items SET status = 'removed' WHERE id = ?").bind(id).run();
  const s = await syncDia(env, row.who, id, `${donateLabel(row)} 지움`, me.id);
  if (s.error) {
    await env.DB.prepare("UPDATE donate_items SET status = 'done' WHERE id = ?").bind(id).run();
    return json({ error: s.error }, 409);
  }
  if (s.diff) await notifyDonor(env, row.who, `🎁 기부 기록 지움 · ${donateLabel(row)} · 마일리지 💎${s.diff}`, me.id);
  return json({ ok: true, dia: s.diff });
};
