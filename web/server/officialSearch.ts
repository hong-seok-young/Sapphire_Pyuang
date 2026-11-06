// 아이모 소식 찾기 (제작자 요청 2026-11-06 '아이모 소식도 검색되게, 똑같은 단어만 말고 띄어쓰기 안 해도'). GET /api/official?q= 가 쓴다.
// 띄어쓰기·줄바꿈을 빼고 견주고, 낱말이 여럿이면 순서와 상관없이 모두 든 글. 제목, 본문(자르지 않은 원문 official_rich, 없으면 body),
// 그림 속 글자(official_img, server/officialImages.ts)에서 찾는다. 제목에 다 든 글 먼저, 새 글 먼저, 100개까지
import type { Env } from "./auth";

/** 띄어쓰기·줄바꿈을 뺀 글 (SQL) */
const bare = (col: string) => `lower(replace(replace(replace(replace(${col}, ' ', ''), char(10), ''), char(13), ''), char(9), ''))`;

/** 찾기: 낱말(띄어쓰기를 뺀 것)이 모두 제목·본문·그림 글자 어딘가에 든 글. 제목에 다 든 글 먼저, 새 글 먼저 */
export async function findOfficial(env: Env, tab: string | null, q: string) {
  const words = [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 5);
  const kind = tab === "event" ? "n.kind = 'event'" : tab === "maint" ? "n.type = 'C'" : tab === "notice" ? "n.kind = 'notice' AND n.type != 'C'" : "1 = 1";
  const has = (col: string, i: number) => `instr(${bare(col)}, ?${i + 1}) > 0`;
  const sql =
    `WITH g AS (SELECT key, ${words.map((_, i) => `${has("text", i)} AS g${i}`).join(", ")} FROM official_img WHERE text != '' AND (${words.map((_, i) => has("text", i)).join(" OR ")})), ` +
    `gi AS (SELECT r.id, ${words.map((_, i) => `MAX(g.g${i}) AS g${i}`).join(", ")} FROM official_rich r, json_each(r.keys) k JOIN g ON g.key = k.value GROUP BY r.id) ` +
    `SELECT n.id, n.kind, n.type, n.title, n.start_date AS start, n.end_date AS end, n.image, ` +
    `(${words.map((_, i) => has("n.title", i)).join(" AND ")}) AS in_title, ` +
    `(${words.map((_, i) => has("COALESCE(r.text, n.body)", i)).join(" AND ")}) AS in_body, (gi.id IS NOT NULL) AS in_img, ` +
    "(SELECT COUNT(*) FROM official_views v WHERE v.post_id = n.id) AS views, " +
    "(SELECT COUNT(*) FROM official_likes l WHERE l.post_id = n.id) AS likes, " +
    "(SELECT COUNT(*) FROM official_comments c WHERE c.post_id = n.id) AS comments " +
    `FROM official_news n LEFT JOIN official_rich r ON r.id = n.id LEFT JOIN gi ON gi.id = n.id WHERE ${kind} AND ` +
    words.map((_, i) => `(${has("n.title", i)} OR ${has("COALESCE(r.text, n.body)", i)} OR COALESCE(gi.g${i}, 0))`).join(" AND ") +
    " ORDER BY in_title DESC, n.id DESC LIMIT 100";
  const { results } = await env.DB.prepare(sql)
    .bind(...words.map((w) => w.replace(/\s+/g, "")))
    .all<Record<string, unknown> & { in_title: number; in_body: number; in_img: number }>();
  return {
    items: results.map(({ in_title, in_body, in_img, ...it }) => ({ ...it, hit: in_title ? "title" : in_body || !in_img ? "body" : "image" })),
    more: false,
    checkedAt: null,
  };
}
