// GET  /api/board?cat=&q=&before= -> 글 목록 (로그인한 길드원 누구나). 첫 쪽에는 고정 글을 위에. 30개씩
// POST /api/board { cat, title, body } -> 글 쓰기 { id }. 사진과 파일은 그다음 /api/board/:id/files 로 하나씩 올린다
import { NEED_LOGIN, FORBIDDEN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { BODY_MAX, CAT_NAME, TITLE_MAX, canWrite, isCat } from "../../../server/board";
import { notify } from "../../../server/alerts";

const PAGE = 30;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const p = new URL(request.url).searchParams;
  const cat = p.get("cat");
  const q = (p.get("q") ?? "").trim().slice(0, 40);
  const before = Number(p.get("before")) || 0;
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (isCat(cat)) {
    where.push("p.cat = ?");
    binds.push(cat);
  }
  if (q) {
    where.push("(p.title LIKE ? OR p.body LIKE ? OR p.author LIKE ?)");
    const like = `%${q.replace(/[%_]/g, "")}%`;
    binds.push(like, like, like);
  }
  if (before > 0) {
    where.push("p.id < ?");
    binds.push(before);
  }
  // 첫 쪽(검색 아님)만 고정 글을 맨 위에
  const order = before === 0 && !q ? "p.pinned DESC, p.id DESC" : "p.id DESC";
  const { results } = await env.DB.prepare(
    "SELECT p.id, p.cat, p.author, p.title, substr(p.body, 1, 120) AS snippet, p.pinned, p.created_at AS at, " +
      "(SELECT COUNT(*) FROM board_comments c WHERE c.post_id = p.id) AS comments, " +
      "(SELECT COUNT(*) FROM board_likes l WHERE l.post_id = p.id) AS likes, " +
      "(SELECT COUNT(*) FROM board_views v WHERE v.post_id = p.id) AS views, " +
      "(SELECT COUNT(*) FROM board_files f WHERE f.post_id = p.id AND f.image = 0) AS files, " +
      "(SELECT f.id FROM board_files f WHERE f.post_id = p.id AND f.image = 1 ORDER BY f.id LIMIT 1) AS thumb " +
      "FROM board_posts p" + (where.length ? " WHERE " + where.join(" AND ") : "") + ` ORDER BY ${order} LIMIT ${PAGE}`,
  )
    .bind(...binds)
    .all<{ id: number; pinned: number }>();
  return json({ posts: results.map((r) => ({ ...r, pinned: r.pinned === 1 })), more: results.length === PAGE });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ cat: unknown; title: unknown; body: unknown }>(request);
  if (!isCat(b.cat)) return json({ error: "게시판을 골라 주세요" }, 400);
  if (!canWrite(me.role, b.cat)) return FORBIDDEN();
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const body = typeof b.body === "string" ? b.body.replace(/\r\n/g, "\n").trim() : "";
  if (!title || title.length > TITLE_MAX) return json({ error: `제목은 ${TITLE_MAX}자까지 적어 주세요` }, 400);
  if (body.length > BODY_MAX) return json({ error: `내용은 ${BODY_MAX}자까지예요` }, 400);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM board_posts WHERE author = ? AND created_at > ?")
    .bind(me.id, Date.now() - 60_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 3) return json({ error: "잠깐 뒤에 다시 써 주세요" }, 429);
  const row = await env.DB.prepare("INSERT INTO board_posts (cat, author, title, body, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(b.cat, me.id, title, body, Date.now())
    .first<{ id: number }>();
  if (!row) return json({ error: "글을 올리지 못했어요" }, 500);
  // 공지사항과 이벤트는 모두에게 알린다 (끈 사람 빼고)
  if (b.cat !== "free") await notify(env, "all", "board_notice", `[${CAT_NAME[b.cat]}] ${title}`, `#/board/${row.id}`, me.id);
  return json({ id: row.id }, 201);
};
