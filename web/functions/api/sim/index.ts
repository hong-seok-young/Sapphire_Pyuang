// 확률 시뮬레이터 순위 (개발중, 제작자 요청 2026-11-04 '각 시뮬레이터별로 몇 번 만에 몇 강을 했는지 순위, 도박왕 통합 랭킹도, 재미로'). 표 sim_records (schema.sql).
// GET  /api/sim?game=… -> { board(그 시뮬레이터 20위까지), mine(내 기록과 순위) }
// GET  /api/sim        -> { king(도박왕 20위까지: 묶음마다 가장 큰 운의 합), firsts(시뮬레이터마다 1위), mine(내 기록 모두) }
// POST /api/sim { game, cat, label, score, tries, luck } -> 내 기록보다 좋을 때만 바꾼다 (화면이 셈한 값이라 재미로만, 값의 범위만 본다)
// 미리 보는 사람(운영진, 앱개발자, 테스트 계정)만. 테스트 계정은 순위에 안 나온다
import { FORBIDDEN, NEED_LOGIN, RANK, TEST_IDS, currentUser, json, readJson } from "../../../server/auth";
import type { Env, User } from "../../../server/auth";

/** 앱개발자(와 그 테스트 계정)만 (제작자 2026-11-04 '개발 중으로 나만 보게') */
const canSim = (me: User) => me.role === "developer" || TEST_IDS.includes(me.id);
const CATS = ["enhance", "grow", "option", "gem", "box"];
const NOT_TEST = `user_id NOT IN (${TEST_IDS.map((t) => `'${t}'`).join(", ")})`;
const ORDER = "score DESC, tries ASC, at ASC";
interface Rec {
  user_id: string;
  game: string;
  cat: string;
  label: string;
  score: number;
  tries: number;
  luck: number;
  at: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canSim(me)) return FORBIDDEN();
  const game = new URL(request.url).searchParams.get("game");
  if (game) {
    const [board, mine] = await env.DB.batch([
      env.DB.prepare(`SELECT user_id, label, score, tries, luck, at FROM sim_records WHERE game = ? AND ${NOT_TEST} ORDER BY ${ORDER} LIMIT 20`).bind(game),
      env.DB.prepare(
        `SELECT r.label, r.score, r.tries, r.luck, r.at, (SELECT COUNT(*) + 1 FROM sim_records o WHERE o.game = r.game AND o.${NOT_TEST} ` +
          "AND (o.score > r.score OR (o.score = r.score AND (o.tries < r.tries OR (o.tries = r.tries AND o.at < r.at))))) AS rank FROM sim_records r WHERE r.game = ? AND r.user_id = ?",
      ).bind(game, me.id),
    ]);
    return json({ board: board.results, mine: mine.results[0] ?? null }, 200, { "cache-control": "no-store" });
  }
  const [king, firsts, mine] = await env.DB.batch([
    env.DB.prepare(
      `SELECT user_id, SUM(best) AS total, GROUP_CONCAT(cat || ':' || ROUND(best, 2)) AS parts FROM ` +
        `(SELECT user_id, cat, MAX(luck) AS best FROM sim_records WHERE ${NOT_TEST} GROUP BY user_id, cat) GROUP BY user_id ORDER BY total DESC LIMIT 20`,
    ),
    env.DB.prepare(
      `SELECT game, user_id, label, score, tries, luck FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY game ORDER BY ${ORDER}) AS rn FROM sim_records WHERE ${NOT_TEST}) WHERE rn = 1 ORDER BY luck DESC`,
    ),
    env.DB.prepare("SELECT game, cat, label, score, tries, luck, at FROM sim_records WHERE user_id = ?").bind(me.id),
  ]);
  return json({ king: king.results, firsts: firsts.results, mine: mine.results }, 200, { "cache-control": "no-store" });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canSim(me)) return FORBIDDEN();
  const b = await readJson<Partial<Rec>>(request);
  const game = typeof b.game === "string" ? b.game.trim() : "";
  const label = typeof b.label === "string" ? b.label.trim().slice(0, 60) : "";
  const score = Number(b.score);
  const tries = Math.round(Number(b.tries));
  const luck = Number(b.luck);
  if (!game || game.length > 60 || !label || !CATS.includes(String(b.cat)) || !Number.isFinite(score) || Math.abs(score) > 1e7 || !(tries >= 1 && tries <= 1e9) || !(luck >= 0 && luck <= 15))
    return json({ error: "기록이 맞지 않아요" }, 400);
  const r = await env.DB.prepare(
    "INSERT INTO sim_records (user_id, game, cat, label, score, tries, luck, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) " +
      "ON CONFLICT(user_id, game) DO UPDATE SET cat = excluded.cat, label = excluded.label, score = excluded.score, tries = excluded.tries, luck = excluded.luck, at = excluded.at " +
      "WHERE excluded.score > sim_records.score OR (excluded.score = sim_records.score AND excluded.tries < sim_records.tries)",
  )
    .bind(me.id, game, b.cat, label, score, tries, luck, Date.now())
    .run();
  // 전광판: 1/100 보다 드문 결과는 기록이 아니어도 남긴다 (같은 사람은 10초에 한 번)
  if (luck >= 2 && !TEST_IDS.includes(me.id))
    await env.DB.prepare("INSERT INTO sim_feed (user_id, game, label, luck, at) SELECT ?1, ?2, ?3, ?4, ?5 WHERE NOT EXISTS (SELECT 1 FROM sim_feed WHERE user_id = ?1 AND at > ?5 - 10000)")
      .bind(me.id, game, label, luck, Date.now())
      .run();
  return json({ ok: true, better: (r.meta.changes ?? 0) > 0 });
};
