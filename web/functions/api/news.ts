// GET /api/news?board=<ms>&market=<ms>&requests=<ms> -> { board, market, requests } : 그때 뒤로 다른 사람이 새로 올린 것의 수
// 제작자 요청 2026-11-01: 개발 업데이트('UPDATE')와 따로, 사람들이 쓰면서 생긴 새 글·새 물건은 숫자 배지로 (홈 칸과 아래 탭).
// 언제부터 셀지는 화면이 그 메뉴를 마지막으로 연 때를 기기에 적어 두었다가 보낸다 (src/news.ts). 내가 올린 것은 세지 않는다.
//   board: 게시판 새 글 / market: 중개인 새 물건(판매 중)과 새 골드 글 / requests: 의뢰소 새 의뢰(끝나지 않은 것)
//   maint: 아이모 점검 (홈 점검 전광판, 제작자 요청 2026-11-01, server/maint.ts). 점검 글은 2분에 한 번 뒤에서 새로 받는다 (server/official.ts refreshMaint)
import { NEED_LOGIN, currentUser, json } from "../../server/auth";
import type { Env } from "../../server/auth";
import { activeMaint } from "../../server/maint";
import { EVENT_EVERY, MAINT_EVERY, refreshEvents, refreshMaint } from "../../server/official";

const since = (url: URL, k: string) => {
  const n = Number(url.searchParams.get(k));
  return Number.isFinite(n) && n > 0 ? n : Date.now();
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const url = new URL(request.url);
  const now = Date.now();
  const [board, listings, gold, requests, maint, checked] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM board_posts WHERE created_at > ? AND author != ?").bind(since(url, "board"), me.id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM listings WHERE created_at > ? AND seller != ? AND status = 'selling'").bind(since(url, "market"), me.id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM gold_offers WHERE created_at > ? AND owner != ? AND status = 'open'").bind(since(url, "market"), me.id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE created_at > ? AND owner != ? AND status != 'done'").bind(since(url, "requests"), me.id),
    // 점검 글 최근 3개 (색인 official_news_type, 본문은 점검 시간·서버·인던 제한이 있는 앞부분만)
    env.DB.prepare("SELECT id, title, start_date, substr(body, 1, 3000) AS body FROM official_news WHERE type = 'C' ORDER BY id DESC LIMIT 3"),
    env.DB.prepare("SELECT key, done_at FROM setup WHERE key IN ('official_maint_checked', 'official_event_checked')"),
  ]);
  const n = (r: D1Result) => (r.results[0] as { n: number } | undefined)?.n ?? 0;
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
      board: n(board),
      market: n(listings) + n(gold),
      requests: n(requests),
      maint: activeMaint(maint.results as { id: number; title: string; body: string; start_date: string | null }[], now),
    },
    200,
    { "cache-control": "no-store" },
  );
};
