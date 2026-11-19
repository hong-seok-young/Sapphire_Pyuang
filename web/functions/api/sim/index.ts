// 확률 시뮬레이터 순위 (개발중). 표 sim_wallet (명성), sim_records (이번 주 기록), sim_feed (전광판).
// 2026-11-19 통합 순위 (제작자 '종류별로 순위 다 만들지 말고 통합 랭킹', '계급으로', '한 번 1위 먹으면 무한정 1위는 안 되게, 기간을 두든'):
//   순위는 명성(지금까지 쓴 코인, sim_wallet.spent) 하나로. 전체(계급 순)와 이번 주(목요일 10시부터 쓴 코인, week_spent) 둘.
//   계급 이름과 계급장은 화면이 명성으로 그린다 (src/simTier.ts). 예전 도박의 신 점수(묶음마다 가장 드문 기록의 운의 합)와 시뮬레이터마다 1위 목록은 뺐다 (기록은 표에 남아 있다).
// GET  /api/sim            -> { all(전체 50위까지 [{ user_id, xp }]), week(이번 주 50위까지), me({ xp, week, rank, weekRank }), wk(이번 주가 시작한 때) }
// GET  /api/sim?game=…     -> { board(그 기록 20위까지, 명성 xp 와 함께), mine(내 기록과 순위) }
//      기록은 이번 주 것만 남긴다: 화면이 game 끝에 '@<주 번호>' 를 붙인다 (강화 'up:<장비>:<마법서>:<강화도>[:ev]@주' = 쓴 코인이 적은 순, 스탯 부여 'stat:<표>@주' = 적게 누른 순)
// POST /api/sim { game, cat, label, score, tries, luck } -> 내 기록보다 좋을 때만 바꾼다 (화면이 셈한 값이라 재미로만, 값의 범위만 본다). luck 이 2 이상이면 전광판에도
// POST /api/sim { feed: true, game, label, luck }       -> 전광판에만 (순위가 없는 옵션·뽑기·보석의 드문 결과, luck 2 이상, 한 사람 10초에 하나)
// POST /api/sim { promo: 계급 번호 }                    -> 새 칭호가 됐다 (다섯 계급마다). 서버 명성으로 확인하고 전광판에 한 번 남긴다
// 쓰는 사람(server/simcoin.ts canSim)만. 테스트 계정과 앱개발자는 순위에 안 나온다 (NOT_RANKED)
import { FORBIDDEN, NEED_LOGIN, TEST_IDS, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { NOT_RANKED, rankOf, refillable, spaceOf, tbl } from "../../../server/simcoin";
import { weekStart } from "../../../server/week";

const CATS = ["enhance", "grow", "option", "gem", "box"];
const ORDER = "r.score DESC, r.tries ASC, r.at ASC";
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
  const space = spaceOf(request, me);
  if (!space) return FORBIDDEN();
  const T = tbl(space);
  const game = new URL(request.url).searchParams.get("game");
  if (game) {
    const [board, mine] = await env.DB.batch([
      env.DB.prepare(
        `SELECT r.user_id, r.label, r.score, r.tries, r.luck, r.at, w.spent AS xp FROM ${T}records r LEFT JOIN ${T}wallet w ON w.user_id = r.user_id ` + `WHERE r.game = ? AND ${NOT_RANKED("r.user_id")} ORDER BY ${ORDER} LIMIT 20`,
      ).bind(game),
      env.DB.prepare(
        `SELECT r.label, r.score, r.tries, r.luck, r.at, (SELECT COUNT(*) + 1 FROM ${T}records o WHERE o.game = r.game AND ${NOT_RANKED("o.user_id")} ` +
          `AND (o.score > r.score OR (o.score = r.score AND (o.tries < r.tries OR (o.tries = r.tries AND o.at < r.at))))) AS rank FROM ${T}records r WHERE r.game = ? AND r.user_id = ?`,
      ).bind(game, me.id),
    ]);
    return json({ board: board.results, mine: mine.results[0] ?? null }, 200, { "cache-control": "no-store" });
  }
  const wk = weekStart();
  const ok = NOT_RANKED("user_id");
  const [all, week, mine] = await env.DB.batch([
    env.DB.prepare(`SELECT user_id, spent AS xp FROM ${T}wallet WHERE spent > 0 AND ${ok} ORDER BY spent DESC, updated_at ASC LIMIT 50`),
    env.DB.prepare(`SELECT user_id, week_spent AS xp, spent AS total FROM ${T}wallet WHERE week = ?1 AND week_spent > 0 AND ${ok} ORDER BY week_spent DESC, updated_at ASC LIMIT 50`).bind(wk),
    env.DB.prepare(
      `SELECT m.spent AS xp, CASE WHEN m.week = ?2 THEN COALESCE(m.week_spent, 0) ELSE 0 END AS week, ` +
        `(SELECT COUNT(*) + 1 FROM ${T}wallet o WHERE o.spent > m.spent AND ${NOT_RANKED("o.user_id")}) AS rank, ` +
        `(SELECT COUNT(*) + 1 FROM ${T}wallet o WHERE o.week = ?2 AND o.week_spent > CASE WHEN m.week = ?2 THEN COALESCE(m.week_spent, 0) ELSE 0 END AND ${NOT_RANKED("o.user_id")}) AS weekRank ` +
        `FROM ${T}wallet m WHERE m.user_id = ?1`,
    ).bind(me.id, wk),
  ]);
  const m = mine.results[0] as { xp: number; week: number; rank: number; weekRank: number } | undefined;
  // 순위에서 빠지는 사람(앱개발자, 테스트 계정)은 계급만 보이고 등수는 없다
  const listed = !refillable(me) && !TEST_IDS.includes(me.id);
  return json({ all: all.results, week: week.results, me: m ? { xp: m.xp, week: m.week, rank: listed ? m.rank : null, weekRank: listed && m.week > 0 ? m.weekRank : null } : null, wk }, 200, { "cache-control": "no-store" });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const space = spaceOf(request, me);
  if (!space) return FORBIDDEN();
  const T = tbl(space);
  const b = await readJson<Partial<Rec> & { feed?: unknown; promo?: unknown }>(request);
  const now = Date.now();
  const quiet = TEST_IDS.includes(me.id);
  // 새 칭호 마디: 계급 스물마다 (칭호 넷, 계급장 그림이 바뀔 때. 화면 src/simTier.ts FEED_EVERY). 서버가 가진 명성으로 그 계급이 맞는지 보고, 같은 칭호는 한 번만 전광판에 (코인이 저절로 채워지는 앱개발자는 남기지 않는다)
  if (b.promo !== undefined) {
    const n = Math.round(Number(b.promo));
    if (!(n >= 20 && n <= 100_000) || n % 20 !== 0) return json({ error: "계급이 맞지 않아요" }, 400);
    if (quiet || refillable(me)) return json({ ok: true, posted: false });
    const w = await env.DB.prepare(`SELECT spent FROM ${T}wallet WHERE user_id = ?`).bind(me.id).first<{ spent: number }>();
    if (!w || rankOf(w.spent) < n) return json({ ok: true, posted: false });
    const r = await env.DB.prepare(`INSERT INTO ${T}feed (user_id, game, label, luck, at) SELECT ?1, 'rank', ?2, 0, ?3 WHERE NOT EXISTS (SELECT 1 FROM ${T}feed WHERE user_id = ?1 AND game = 'rank' AND label = ?2)`)
      .bind(me.id, String(n), now)
      .run();
    return json({ ok: true, posted: (r.meta.changes ?? 0) > 0 });
  }
  const game = typeof b.game === "string" ? b.game.trim() : "";
  const label = typeof b.label === "string" ? b.label.trim().slice(0, 60) : "";
  const luck = Number(b.luck);
  if (!game || game.length > 60 || game === "rank" || !label || !(luck >= 0 && luck <= 15)) return json({ error: "기록이 맞지 않아요" }, 400);
  const toFeed = () =>
    luck >= 2 && !quiet
      ? env.DB.prepare(`INSERT INTO ${T}feed (user_id, game, label, luck, at) SELECT ?1, ?2, ?3, ?4, ?5 WHERE NOT EXISTS (SELECT 1 FROM ${T}feed WHERE user_id = ?1 AND game <> 'rank' AND at > ?5 - 10000)`)
          .bind(me.id, game, label, luck, now)
          .run()
      : null;
  if (b.feed) {
    await toFeed();
    return json({ ok: true });
  }
  const score = Number(b.score);
  const tries = Math.round(Number(b.tries));
  if (!CATS.includes(String(b.cat)) || !Number.isFinite(score) || Math.abs(score) > 1e7 || !(tries >= 1 && tries <= 1e9)) return json({ error: "기록이 맞지 않아요" }, 400);
  const r = await env.DB.prepare(
    `INSERT INTO ${T}records (user_id, game, cat, label, score, tries, luck, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ` +
      "ON CONFLICT(user_id, game) DO UPDATE SET cat = excluded.cat, label = excluded.label, score = excluded.score, tries = excluded.tries, luck = excluded.luck, at = excluded.at " +
      `WHERE excluded.score > ${T}records.score OR (excluded.score = ${T}records.score AND excluded.tries < ${T}records.tries)`,
  )
    .bind(me.id, game, b.cat, label, score, tries, luck, now)
    .run();
  await toFeed();
  return json({ ok: true, better: (r.meta.changes ?? 0) > 0 });
};
