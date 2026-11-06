// GET /api/news?board.notice=<ms>&…&imo.event=<ms>&… -> { counts: { 'board.notice': n, … }, maint }:
// 그때 뒤로 다른 사람이 새로 올린 것의 수. 2026-11-02 제작자 요청으로 칸 안의 단추마다 따로 센다 (src/news.ts KEYS).
//   board.<칸>: 게시판 칸마다 새 글 / imo.notice·maint·event: 아이모 소식 새 공식 글 (공지·안내·오류, 점검, 이벤트. 우리 표에 처음 들어온 때 added_at 으로 센다:
//   공식 글 번호는 예약 글이 먼저 번호를 받아 올린 순서와 다를 때가 있어서 번호로 세면 새 글을 놓쳤다, 2026-11-02. 한국 PC 파일로 늦게 들어온 예전 글은
//   올린 날이 최근 3일 안인 것만) / market.items: 중개인 새 물건(판매 중)
//   market.gold: 새 골드 글 / requests: 의뢰소 새 의뢰(끝나지 않은 것) / rent.list: 장비대여 새 무기 / rent.apps: 내 신청에 생긴 일(수락, 대여 완료, 반납, 대화 …,
//   신청함으로 가는 알림) / rent.staff: 운영진에게 새 신청, 신청한 사람의 대화, 반납 신청. 장비대여는 들어갈 수 있는 사람(rental.ts canEnter)만, rent.staff 는 운영진만.
// 예전 화면(?board=&market=&requests=)에는 board, market, requests 도 같이 준다.
//   things: [키, 단추, 때, 쪽] 줄들 (제작자 2026-11-06 '버튼에만 배지 달게 아니라 끝까지 배지가 추적해서, 마지막까지 사용자가 들어가서 봐야 배지가 없어지게'):
//   다른 사람이 그 단추 안에서 한 일 하나하나. 'post:<글>'(새 글·댓글), 'imo:<글>', 'item:<물건>'(새 물건), 'talk:<물건>'(토론방 글), 'gold:<글>', 'req:<의뢰>'(새 의뢰·내 의뢰 수락),
//   'rent:<무기>'. 쪽은 물건·골드의 sell|buy, 장비대여의 직업. 화면(src/news.ts)이 글·물건마다 연 때와 견줘 새 것을 세고, 그 글·물건을 열어야 지운다. 최근 14일 것만
//   maint: 아이모 점검 (홈 점검 전광판, 제작자 요청 2026-11-01, server/maint.ts). 점검 글은 2분에 한 번 뒤에서 새로 받는다 (server/official.ts refreshMaint)
import { NEED_LOGIN, currentUser, json } from "../../server/auth";
import type { Env } from "../../server/auth";
import { activeMaint } from "../../server/maint";
import { EVENT_EVERY, MAINT_EVERY, refreshEvents, refreshMaint } from "../../server/official";
import { NEW_OFFICIAL_SQL, announceOfficial } from "../../server/officialAlert";
import type { NewOfficial } from "../../server/officialAlert";
import { canEnter, isManager } from "../../server/rental";
import { remindIfDue } from "../../server/gdungeon";
import { announceApp } from "../../server/appNews";

const IMO: Record<string, string> = { "imo.notice": "type IN ('N', 'I', 'D')", "imo.maint": "type = 'C'", "imo.event": "type = 'E'" };
/** 아이모 소식은 올린 날이 이 날수 안인 것만 센다 (늦게 들어온 예전 글은 새 글이 아니다) */
const IMO_DAYS = 3;
const MINE = "(SELECT id FROM users WHERE id = ?9 OR main_id = ?9)";
/** 글·물건마다 따라가는 새 것은 이만큼 지난 것까지 (그보다 오래된 것은 본 것으로) */
const THING_DAYS = 14;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const url = new URL(request.url);
  const now = Date.now();
  const num = (k: string) => {
    const n = Number(url.searchParams.get(k));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  /** 그 단추를 마지막으로 본 때 (없으면 예전 칸 하나짜리 값, 그것도 없으면 지금). 예전 화면이 보내던 공식 글 번호(때보다 작은 수)는 지금으로 */
  const since = (k: string) => {
    const v = num(k) ?? num(k.split(".")[0]);
    return v !== null && v > 1e12 ? v : now;
  };
  const owner = me.owner ?? me.id;
  const rent = canEnter(me);
  const manager = rent && isManager(me);
  // 모든 문장이 같은 자리표를 쓴다 (?9 = 본캐 아이디). 문장에 있는 자리표 수만큼만 넣는다 (더 넣으면 D1 이 거절한다)
  const q = (sql: string, ...args: unknown[]) => {
    const count = Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
    const binds: unknown[] = new Array(count).fill(null);
    args.forEach((a, i) => i < count && (binds[i] = a));
    if (count >= 9) binds[8] = owner;
    return env.DB.prepare(sql).bind(...binds);
  };
  const boardSince = ["notice", "event", "free", "suggest"].map((c) => since(`board.${c}`));
  const imoKeys = Object.keys(IMO);
  const imoSince = imoKeys.map(since);
  const imoFrom = new Date(now + 9 * 3_600_000 - IMO_DAYS * 86_400_000).toISOString().slice(0, 10);
  // 글·물건마다 따라가는 새 것 (things): 단추를 마지막으로 본 때와 14일 전 중 늦은 때부터
  const floor = (...keys: string[]) => Math.max(now - THING_DAYS * 86_400_000, Math.min(...keys.map(since)));
  const thingSql = [
    q(`SELECT 'post:' || id AS k, 'board.' || cat AS c, created_at AS t, NULL AS s FROM board_posts WHERE created_at > ?1 AND author NOT IN ${MINE}`, floor(...boardSince.map((_, j) => `board.${["notice", "event", "free", "suggest"][j]}`))),
    q(
      `SELECT 'post:' || c.post_id AS k, 'board.' || p.cat AS c, c.created_at AS t, NULL AS s FROM board_comments c JOIN board_posts p ON p.id = c.post_id ` +
        `WHERE c.created_at > ?1 AND c.user_id NOT IN ${MINE}`,
      floor("board.notice", "board.event", "board.free", "board.suggest"),
    ),
    q(
      `SELECT 'imo:' || id AS k, CASE WHEN type = 'C' THEN 'imo.maint' WHEN type = 'E' THEN 'imo.event' ELSE 'imo.notice' END AS c, added_at AS t, NULL AS s ` +
        "FROM official_news WHERE added_at > ?1 AND (start_date IS NULL OR start_date >= ?2)",
      floor(...imoKeys),
      imoFrom,
    ),
    q(`SELECT 'item:' || id AS k, 'market.items' AS c, created_at AS t, side AS s FROM listings WHERE created_at > ?1 AND seller NOT IN ${MINE} AND status = 'selling'`, floor("market.items")),
    q(
      `SELECT 'talk:' || t.listing_id AS k, 'market.items' AS c, t.created_at AS t, l.side AS s FROM listing_talk t JOIN listings l ON l.id = t.listing_id ` +
        `WHERE t.created_at > ?1 AND t.user_id NOT IN ${MINE} AND (l.status = 'selling' OR l.seller IN ${MINE})`,
      floor("market.items"),
    ),
    q(`SELECT 'gold:' || id AS k, 'market.gold' AS c, created_at AS t, side AS s FROM gold_offers WHERE created_at > ?1 AND owner NOT IN ${MINE} AND status = 'open'`, floor("market.gold")),
    q(`SELECT 'req:' || id AS k, 'requests' AS c, created_at AS t, NULL AS s FROM requests WHERE created_at > ?1 AND owner NOT IN ${MINE} AND status != 'done'`, floor("requests")),
    q(
      `SELECT 'req:' || o.request_id AS k, 'requests' AS c, o.created_at AS t, NULL AS s FROM request_offers o JOIN requests r ON r.id = o.request_id ` +
        `WHERE o.created_at > ?1 AND r.owner IN ${MINE} AND o.user_id NOT IN ${MINE} AND o.status = 'pledged' AND r.status != 'done'`,
      floor("requests"),
    ),
    ...(rent
      ? [q(`SELECT 'rent:' || id AS k, 'rent.list' AS c, created_at AS t, job AS s FROM rental_items WHERE created_at > ?1 AND status = 'open' AND COALESCE(updated_by, '') NOT IN ${MINE}`, floor("rent.list"))]
      : []),
  ];
  const results = await env.DB.batch([
    ...thingSql,
    q(
      "SELECT SUM(cat = 'notice' AND created_at > ?1) AS notice, SUM(cat = 'event' AND created_at > ?2) AS event, " +
        "SUM(cat = 'free' AND created_at > ?3) AS free, SUM(cat = 'suggest' AND created_at > ?4) AS suggest " +
        `FROM board_posts WHERE created_at > ?5 AND author NOT IN ${MINE}`,
      ...boardSince,
      Math.min(...boardSince),
    ),
    q(`SELECT COUNT(*) AS n FROM listings WHERE created_at > ?1 AND seller NOT IN ${MINE} AND status = 'selling'`, since("market.items")),
    q(`SELECT COUNT(*) AS n FROM gold_offers WHERE created_at > ?1 AND owner NOT IN ${MINE} AND status = 'open'`, since("market.gold")),
    q(`SELECT COUNT(*) AS n FROM requests WHERE created_at > ?1 AND owner NOT IN ${MINE} AND status != 'done'`, since("requests")),
    // 아이모 소식: 종류마다 본 때 뒤에 우리 표에 처음 들어온 글 (색인 official_news_added)
    q(
      `SELECT ${imoKeys.map((k, j) => `SUM(${IMO[k]} AND added_at > ?${j + 1}) AS "${k}"`).join(", ")} ` +
        "FROM official_news WHERE added_at > ?4 AND (start_date IS NULL OR start_date >= ?5)",
      ...imoSince,
      Math.min(...imoSince),
      imoFrom,
    ),
    ...(rent
      ? [
          q(`SELECT COUNT(*) AS n FROM rental_items WHERE created_at > ?1 AND status = 'open' AND COALESCE(updated_by, '') NOT IN ${MINE}`, since("rent.list")),
          q(`SELECT COUNT(*) AS n FROM alerts WHERE user_id IN ${MINE} AND kind = 'rent' AND link = '#/rent?v=apps' AND created_at > ?1`, since("rent.apps")),
        ]
      : []),
    ...(manager
      ? [
          q(
            `SELECT (SELECT COUNT(*) FROM rental_requests WHERE created_at > ?1 AND app_id IS NOT NULL AND user_id NOT IN ${MINE}) + ` +
              `(SELECT COUNT(*) FROM rental_talk t JOIN rental_apps a ON a.id = t.app_id WHERE t.created_at > ?1 AND t.user_id = a.user_id AND a.user_id NOT IN ${MINE}) + ` +
              `(SELECT COUNT(*) FROM rental_items WHERE return_req_at > ?1 AND renter NOT IN ${MINE}) AS n`,
            since("rent.staff"),
          ),
        ]
      : []),
    // 점검 글 최근 3개 (색인 official_news_type, 본문은 점검 시간·서버·인던 제한이 있는 앞부분만)
    env.DB.prepare("SELECT id, title, start_date, substr(body, 1, 3000) AS body FROM official_news WHERE type = 'C' ORDER BY id DESC LIMIT 3"),
    env.DB.prepare("SELECT key, done_at FROM setup WHERE key IN ('official_maint_checked', 'official_event_checked')"),
    // 아직 알리지 않은 새 공식 글 (server/officialAlert.ts, 색인 official_news_added)
    env.DB.prepare(NEW_OFFICIAL_SQL).bind(imoFrom),
  ]);
  const n = (r: D1Result | undefined) => Number((r?.results[0] as { n: number | null } | undefined)?.n ?? 0);
  let i = 0;
  const things: [string, string, number, string | null][] = [];
  for (; i < thingSql.length; i++)
    for (const r of results[i].results as { k: string; c: string; t: number; s: string | null }[]) things.push([r.k, r.c, Number(r.t), r.s ?? null]);
  const boardR = (results[i++].results[0] ?? {}) as Record<string, number | null>;
  const counts: Record<string, number> = {
    "board.notice": Number(boardR.notice ?? 0),
    "board.event": Number(boardR.event ?? 0),
    "board.free": Number(boardR.free ?? 0),
    "board.suggest": Number(boardR.suggest ?? 0),
    "market.items": n(results[i++]),
    "market.gold": n(results[i++]),
    requests: n(results[i++]),
  };
  const imoR = (results[i++].results[0] ?? {}) as Record<string, number | null>;
  for (const k of imoKeys) counts[k] = Number(imoR[k] ?? 0);
  if (rent) {
    counts["rent.list"] = n(results[i++]);
    counts["rent.apps"] = n(results[i++]);
  }
  if (manager) counts["rent.staff"] = n(results[i++]);
  const maint = results[i++];
  const checked = results[i++];
  const fresh = results[i++].results as unknown as NewOfficial[];
  // 새 공식 글은 모두에게 알림 (여럿이 같이 와도 한 곳만)
  if (fresh.length) waitUntil(announceOfficial(env, fresh).catch((e) => console.error("official alert", e instanceof Error ? e.message : e)));
  // 뒤에서 공식 글 새로 받기: 점검 글(2분마다)을 먼저, 아니면 새 이벤트 글(15분마다). 한 번에 하나만 (CPU 한도)
  const last = new Map((checked.results as { key: string; done_at: number }[]).map((r) => [r.key, r.done_at]));
  const maintAt = last.get("official_maint_checked") ?? null;
  const eventAt = last.get("official_event_checked") ?? null;
  const job =
    maintAt === null || maintAt < now - MAINT_EVERY
      ? refreshMaint(env, maintAt, now)
      : eventAt === null || eventAt < now - EVENT_EVERY
        ? refreshEvents(env, eventAt, now)
        : null;
  if (job) waitUntil(job.catch((e) => console.error("official refresh", e instanceof Error ? e.message : e)));
  // 길드 던전 새 주 알림 보충 (목 10:30 예약이 늦거나 안 돌았을 때, server/gdungeon.ts remindIfDue: 주 시작 하루 안에만 읽기 하나)
  waitUntil(remindIfDue(env, now).catch((e) => console.error("gd remind", e instanceof Error ? e.message : e)));
  // 새 기능 알림 (server/appNews.ts): 알릴 때부터 이틀 안에, 모두에게 한 번 (먼저 setup 을 적은 한 곳만)
  waitUntil(announceApp(env, now).catch((e) => console.error("app news", e instanceof Error ? e.message : e)));
  return json(
    {
      counts,
      things,
      // 예전 화면
      board: counts["board.notice"] + counts["board.event"] + counts["board.free"] + counts["board.suggest"],
      market: counts["market.items"] + counts["market.gold"],
      requests: counts.requests,
      maint: activeMaint(maint.results as { id: number; title: string; body: string; start_date: string | null }[], now),
    },
    200,
    { "cache-control": "no-store" },
  );
};
