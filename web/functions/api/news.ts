// GET /api/news?board.notice=<ms>&…&imo.event=<글 번호>&… -> { counts: { 'board.notice': n, … }, tops, maint }:
// 그때(아이모 소식은 그 글 번호) 뒤로 다른 사람이 새로 올린 것의 수. 2026-11-02 제작자 요청으로 칸 안의 단추마다 따로 센다 (src/news.ts KEYS).
//   board.<칸>: 게시판 칸마다 새 글 / imo.notice·maint·event: 아이모 소식 새 공식 글 (공지·안내·오류, 점검, 이벤트) / market.items: 중개인 새 물건(판매 중)
//   market.gold: 새 골드 글 / requests: 의뢰소 새 의뢰(끝나지 않은 것) / rent.list: 장비대여 새 무기 / rent.apps: 내 신청에 생긴 일(수락, 대여 완료, 반납, 대화 …,
//   신청함으로 가는 알림) / rent.staff: 운영진에게 새 신청과 신청한 사람의 대화. 장비대여는 들어갈 수 있는 사람(rental.ts canEnter)만, rent.staff 는 운영진만.
//   tops: 아이모 소식 종류마다 가장 새 글 번호 (처음 쓰는 기기는 여기서부터 센다)
// 예전 화면(?board=&market=&requests=)에는 board, market, requests 도 같이 준다.
//   maint: 아이모 점검 (홈 점검 전광판, 제작자 요청 2026-11-01, server/maint.ts). 점검 글은 2분에 한 번 뒤에서 새로 받는다 (server/official.ts refreshMaint)
import { NEED_LOGIN, currentUser, json } from "../../server/auth";
import type { Env } from "../../server/auth";
import { activeMaint } from "../../server/maint";
import { EVENT_EVERY, MAINT_EVERY, refreshEvents, refreshMaint } from "../../server/official";
import { canEnter, isManager } from "../../server/rental";

const IMO: Record<string, string> = { "imo.notice": "type IN ('N', 'I', 'D')", "imo.maint": "type = 'C'", "imo.event": "type = 'E'" };
const MINE = "(SELECT id FROM users WHERE id = ?9 OR main_id = ?9)";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const url = new URL(request.url);
  const now = Date.now();
  const num = (k: string) => {
    const n = Number(url.searchParams.get(k));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  /** 그 단추를 마지막으로 본 때 (없으면 예전 칸 하나짜리 값, 그것도 없으면 지금) */
  const since = (k: string) => num(k) ?? num(k.split(".")[0]) ?? now;
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
  const results = await env.DB.batch([
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
    // 아이모 소식: 종류마다 본 글 번호 뒤의 수와 가장 새 글 번호 (색인 official_news_type). 처음 쓰는 기기(번호 없음)는 0
    ...imoKeys.map((k) =>
      q(`SELECT (SELECT COUNT(*) FROM official_news WHERE ${IMO[k]} AND id > ?1) AS n, (SELECT MAX(id) FROM official_news WHERE ${IMO[k]}) AS top`, num(k) ?? Number.MAX_SAFE_INTEGER),
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
              `(SELECT COUNT(*) FROM rental_talk t JOIN rental_apps a ON a.id = t.app_id WHERE t.created_at > ?1 AND t.user_id = a.user_id AND a.user_id NOT IN ${MINE}) AS n`,
            since("rent.staff"),
          ),
        ]
      : []),
    // 점검 글 최근 3개 (색인 official_news_type, 본문은 점검 시간·서버·인던 제한이 있는 앞부분만)
    env.DB.prepare("SELECT id, title, start_date, substr(body, 1, 3000) AS body FROM official_news WHERE type = 'C' ORDER BY id DESC LIMIT 3"),
    env.DB.prepare("SELECT key, done_at FROM setup WHERE key IN ('official_maint_checked', 'official_event_checked')"),
  ]);
  const n = (r: D1Result | undefined) => Number((r?.results[0] as { n: number | null } | undefined)?.n ?? 0);
  let i = 0;
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
  const tops: Record<string, number> = {};
  for (const k of imoKeys) {
    const r = results[i++].results[0] as { n: number; top: number | null };
    counts[k] = Number(r?.n ?? 0);
    if (r?.top) tops[k] = r.top;
  }
  if (rent) {
    counts["rent.list"] = n(results[i++]);
    counts["rent.apps"] = n(results[i++]);
  }
  if (manager) counts["rent.staff"] = n(results[i++]);
  const maint = results[i++];
  const checked = results[i++];
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
  return json(
    {
      counts,
      tops,
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
