// 생일 스티커 최대 콤보 순위 (제작자 요청 2026-11-07 '최대 콤보 순위도 어딘가에 나열')
// GET  /api/bday?key=village-2026      -> { top: [{ id, best }], mine: { best, rank } | null, total }
// POST /api/bday { key, combo }         -> 내 최고 콤보를 바꾼다 (더 클 때만), 답은 GET 과 같다
// 콤보는 스티커·풍선을 1.3초 안에 이어 누른 수로 화면이 센다. 그날 0시 전 기록(앱개발자 미리 보기)은 그날이 되면 순위에서 빠지고 덮인다.
// 테스트 계정은 순위에 넣지 않는다
import { NEED_LOGIN, TEST_IDS, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { BDAYS, MAX_COMBO } from "../../../server/birthday";

const TOP = 20;
const NOT_TEST = `user_id NOT IN (${TEST_IDS.map((id) => `'${id}'`).join(", ")})`;

/** 순위에 넣는 기록의 시작: 그날이 되면 그날 0시부터, 그 전(미리 보기)에는 모두 */
const sinceOf = (key: string) => {
  const d = BDAYS[key];
  return d && Date.now() >= d.start ? d.start : 0;
};

async function board(env: Env, key: string, me: string) {
  const since = sinceOf(key);
  const [top, mine, total] = await Promise.all([
    env.DB.prepare(`SELECT user_id AS id, best FROM bday_combo WHERE bday = ? AND at >= ? AND ${NOT_TEST} ORDER BY best DESC, at ASC LIMIT ${TOP}`)
      .bind(key, since)
      .all<{ id: string; best: number }>(),
    env.DB.prepare("SELECT best, at FROM bday_combo WHERE bday = ? AND user_id = ? AND at >= ?").bind(key, me, since).first<{ best: number; at: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM bday_combo WHERE bday = ? AND at >= ? AND ${NOT_TEST}`).bind(key, since).first<{ n: number }>(),
  ]);
  let mineOut: { best: number; rank: number | null } | null = null;
  if (mine) {
    const ahead = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM bday_combo WHERE bday = ? AND at >= ? AND ${NOT_TEST} AND (best > ? OR (best = ? AND at < ?))`,
    )
      .bind(key, since, mine.best, mine.best, mine.at)
      .first<{ n: number }>();
    mineOut = { best: mine.best, rank: TEST_IDS.includes(me) ? null : (ahead?.n ?? 0) + 1 };
  }
  return { top: top.results, mine: mineOut, total: total?.n ?? 0 };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!BDAYS[key]) return json({ error: "없는 생일이에요" }, 404);
  return json(await board(env, key, me.id));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ key: unknown; combo: unknown }>(request);
  const key = typeof b.key === "string" ? b.key : "";
  const day = BDAYS[key];
  if (!day) return json({ error: "없는 생일이에요" }, 404);
  const combo = Number(b.combo);
  if (!Number.isInteger(combo) || combo < 1 || combo > MAX_COMBO) return json({ error: "콤보가 맞지 않아요" }, 400);
  const now = Date.now();
  // 그날이 끝나고 한 시간 뒤까지 받는다 (자정 직전에 끝난 콤보). 그날 전에는 미리 보는 앱개발자·테스트 계정만
  if (now > day.end + 3600_000) return json({ error: "생일이 지났어요" }, 409);
  if (now < day.start && me.role !== "developer" && !TEST_IDS.includes(me.id)) return json({ error: "아직 생일 전이에요" }, 409);
  await env.DB.prepare(
    "INSERT INTO bday_combo (bday, user_id, best, at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT (bday, user_id) DO UPDATE SET best = excluded.best, at = excluded.at WHERE excluded.best > bday_combo.best OR bday_combo.at < ?",
  )
    .bind(key, me.id, combo, now, sinceOf(key))
    .run();
  return json(await board(env, key, me.id));
};
