// POST   /api/gd/answer { slot, answer: 'yes' | 'no' } -> 지금 후보에 확정·불참 (server/gdungeon.ts)
//   확정: 모두 확정하면 정해지고 파티원에게 알림. 불참: 그 후보는 무산되고 다음 후보로, 파티원에게 알림.
//   정해진 뒤에도 불참할 수 있다 (제작자 요청 2026-11-02: '확정 눌렀어도 일 생겨서 못 가면 불참 누르고 알림 띄워 줘야 함')
//   후보는 칠해 둔 시간표로 뽑지만, 후보에 확정하려면 파티원 모두가 시간표를 확정해야 한다 (제작자 2026-11-04 '4명이 다 시간표 확정을 눌러야 가능하게'):
//   아직인 사람이 있으면 409 '별빛하늘 님이 시간표를 확정해야 확정할 수 있어요 · 별빛하늘 님에게 재촉 알림을 보냈어요' 와 함께 그 사람에게 실제로 알림
//   (같은 사람에게는 10분에 한 번, setup 'gd_poke_<주>_<아이디>_<10분 칸>')
// DELETE /api/gd/answer?slot= -> 내 대답 지우기 (잘못 누른 불참 되돌리기)
// POST   /api/gd/answer { reset: true } -> 처음부터 다시 정하기 (파티장, 운영진): 이번 주 대답을 모두 지운다
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { canManageParty, canUseGd, candidateNo, oneParty, partyIdOf, slotText, tellParty, weeks } from "../../../server/gdungeon";
import { notify } from "../../../server/alerts";

const POKE_MS = 10 * 60_000;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!(await canUseGd(env, me))) return FORBIDDEN();
  const b = await readJson<{ slot: unknown; answer: unknown; reset: unknown }>(request);
  const now = Date.now();
  const { week } = weeks(now);
  const partyId = await partyIdOf(env, me.id);
  const p = partyId ? await oneParty(env, partyId, week, now) : null;
  if (!p) return json({ error: "파티에 들어가 있지 않아요" }, 404);

  if (b.reset === true) {
    if (!canManageParty(me, p.leader)) return FORBIDDEN();
    await env.DB.prepare("DELETE FROM gd_answers WHERE party_id = ? AND week = ?").bind(p.id, week).run();
    const after = await oneParty(env, p.id, week, now);
    if (after) await tellParty(env, after, `[${p.name}] 이번 주 때를 처음부터 다시 정해요${after.current !== null ? ` · 1번 후보 ${slotText(week, after.current)}` : ""}`, me.id);
    return json({ ok: true, party: after });
  }

  const slot = Number(b.slot);
  const answer = b.answer === "yes" || b.answer === "no" ? b.answer : null;
  if (!answer) return json({ error: "확정이나 불참을 골라 주세요" }, 400);
  // 확정은 지금 후보에만, 불참은 지금 후보나 정해진 때에
  const ok = slot === p.current || (answer === "no" && slot === p.confirmed);
  if (!ok) return json({ error: "후보가 바뀌었어요. 다시 봐 주세요", party: p }, 409);
  if (answer === "yes") {
    const waiting = p.members.filter((m) => !m.confirmed).map((m) => m.id);
    const others = waiting.filter((id) => id !== me.id);
    if (waiting.length) {
      const sent: string[] = [];
      for (const id of others) {
        const r = await env.DB.prepare("INSERT OR IGNORE INTO setup (key, done_at) VALUES (?, ?)")
          .bind(`gd_poke_${week}_${id}_${Math.floor(now / POKE_MS)}`, now)
          .run();
        if (r.meta.changes) sent.push(id);
      }
      if (sent.length) await notify(env, sent, "gdungeon", `[${p.name}] ${me.id} 님이 후보를 확정하려고 해요 · 내 시간표를 보고 확정을 눌러 주세요`, "#/match", me.id);
      const names = others.map((id) => `${id} 님`).join(", ");
      const parts = [
        waiting.includes(me.id) ? "내 시간표를 먼저 확정해 주세요" : "",
        others.length ? `${names}이 시간표를 확정해야 확정할 수 있어요` : "",
        sent.length ? `${sent.map((id) => `${id} 님`).join(", ")}에게 재촉 알림을 보냈어요` : others.length ? "재촉 알림은 조금 전에 보냈어요" : "",
      ].filter(Boolean);
      return json({ error: parts.join(" · "), waiting, nudged: sent }, 409);
    }
  }
  const wasConfirmed = slot === p.confirmed;
  await env.DB.prepare(
    "INSERT INTO gd_answers (party_id, week, slot, user_id, answer, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
      "ON CONFLICT(party_id, week, slot, user_id) DO UPDATE SET answer = ?5, at = ?6",
  )
    .bind(p.id, week, slot, me.id, answer, now)
    .run();
  const after = await oneParty(env, p.id, week, now);
  if (!after) return json({ ok: true });
  const when = slotText(week, slot);
  if (answer === "yes" && after.confirmed === slot) {
    await tellParty(env, after, `[${p.name}] 이번 주 길드 던전은 ${when} 확정!`, me.id);
  } else if (answer === "no") {
    const next = after.current !== null ? `다음은 ${candidateNo(after, after.current)}번 후보 ${slotText(week, after.current)}` : "남은 후보가 없어요 · 시간표를 더 칠해 주세요";
    await tellParty(env, after, `[${p.name}] ${me.id} 님이 ${wasConfirmed ? `정해진 ${when}에 못 가요` : `${when} 불참`} · ${next}`, me.id);
  }
  return json({ ok: true, party: after });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!(await canUseGd(env, me))) return FORBIDDEN();
  const slot = Number(new URL(request.url).searchParams.get("slot"));
  const now = Date.now();
  const { week } = weeks(now);
  const partyId = await partyIdOf(env, me.id);
  if (!partyId) return json({ error: "파티에 들어가 있지 않아요" }, 404);
  await env.DB.prepare("DELETE FROM gd_answers WHERE party_id = ? AND week = ? AND slot = ? AND user_id = ?").bind(partyId, week, slot, me.id).run();
  return json({ ok: true, party: await oneParty(env, partyId, week, now) });
};
