// GET /api/official?tab=all|notice|maint|event&before= -> 컴투스 공식 소식 목록 (로그인한 길드원 누구나, 30개씩, 새 것 먼저)
// all: 전부, notice: 공지사항(공지, 안내, 오류), maint: 점검, event: 이벤트. 본문은 /api/official/:id (게시판 '아이모 소식')
// 자료는 scripts/fetch-official.mjs 가 30분마다 받아 둔다 (server/official.ts)
import { NEED_LOGIN, currentUser, json } from "../../server/auth";
import type { Env } from "../../server/auth";

const PAGE = 30;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const p = new URL(request.url).searchParams;
  const tab = p.get("tab");
  const where = [
    tab === "event" ? "kind = 'event'" : tab === "maint" ? "type = 'C'" : tab === "notice" ? "kind = 'notice' AND type != 'C'" : "1 = 1",
  ];
  const binds: number[] = [];
  const before = Number(p.get("before")) || 0;
  if (before > 0) {
    where.push("id < ?");
    binds.push(before);
  }
  const [rows, checked] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, kind, type, title, start_date AS start, end_date AS end, image, ` +
        "(SELECT COUNT(*) FROM official_views v WHERE v.post_id = official_news.id) AS views, " +
        "(SELECT COUNT(*) FROM official_likes l WHERE l.post_id = official_news.id) AS likes, " +
        "(SELECT COUNT(*) FROM official_comments c WHERE c.post_id = official_news.id) AS comments " +
        `FROM official_news WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ${PAGE}`,
    ).bind(...binds),
    env.DB.prepare("SELECT done_at FROM setup WHERE key = 'official_checked'"),
  ]);
  return json({
    items: rows.results,
    more: rows.results.length === PAGE,
    checkedAt: (checked.results[0] as { done_at: number } | undefined)?.done_at ?? null,
  });
};
