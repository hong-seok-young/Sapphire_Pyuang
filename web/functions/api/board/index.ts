// GET  /api/board?cat=&q=&before=&mine= -> 글 목록 (mine=1 이면 내가 쓴 글만) (로그인한 길드원 누구나). 첫 쪽에는 고정 글을 위에. 30개씩
// POST /api/board { cat, title, body, anon? } -> 글 쓰기 { id }. 사진과 파일은 그다음 /api/board/:id/files 로 하나씩 올린다
// 건의 사항은 익명(anon)으로 올릴 수 있다 (건의함, server/board.ts): 글쓴이가 '익명'으로 보이고(mine 으로 내 글인지만), 글쓴이로 찾아지지 않는다.
// 건의 사항 글은 오피서 이상(앱개발자 포함)과 쓴 사람만 본다 (visiblePosts)
import { NEED_LOGIN, FORBIDDEN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { ANON_NAME, BODY_MAX, CAT_NAME, SUGGEST_OPEN, TITLE_MAX, canSeeAnon, canWrite, isCat, postLink, shownName, visiblePosts } from "../../../server/board";
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
  } else if (SUGGEST_OPEN) where.push("p.cat != 'suggest'"); // 건의함을 열면 게시판 '전체'에는 건의 글을 빼고 건의함에서만
  // 건의 사항은 운영진(오피서 이상)과 쓴 사람만
  const vis = visiblePosts(me);
  if (vis.sql) {
    where.push(vis.sql);
    binds.push(...vis.binds);
  }
  // 건의함 '내 건의함': 내가 쓴 글만 (묶은 캐릭터 것까지)
  if (p.get("mine") === "1") {
    const chars = me.chars?.length ? me.chars : [me.id];
    where.push(`p.author IN (${chars.map(() => "?").join(", ")})`);
    binds.push(...chars);
  }
  if (q) {
    // 익명 글은 글쓴이로 찾지 않는다 (이름을 볼 수 있는 사람만)
    where.push(`(p.title LIKE ? OR p.body LIKE ? OR (p.author LIKE ?${canSeeAnon(env, me) ? "" : " AND p.anon = 0"}))`);
    const like = `%${q.replace(/[%_]/g, "")}%`;
    binds.push(like, like, like);
  }
  if (before > 0) {
    where.push("p.id < ?");
    binds.push(before);
    // 고정 글은 첫 쪽에 이미 나왔다 (검색은 고정 글을 따로 올리지 않아서 그대로)
    if (!q) where.push("p.pinned = 0");
  }
  // 첫 쪽(검색 아님)만 고정 글을 맨 위에
  const order = before === 0 && !q ? "p.pinned DESC, p.id DESC" : "p.id DESC";
  const { results } = await env.DB.prepare(
    "SELECT p.id, p.cat, p.author, p.title, substr(p.body, 1, 120) AS snippet, p.pinned, p.anon, p.created_at AS at, " +
      "(SELECT COUNT(*) FROM board_comments c WHERE c.post_id = p.id) AS comments, " +
      "(SELECT COUNT(*) FROM board_likes l WHERE l.post_id = p.id) AS likes, " +
      "(SELECT COUNT(*) FROM board_views v WHERE v.post_id = p.id) AS views, " +
      "(SELECT COUNT(*) FROM board_files f WHERE f.post_id = p.id AND f.image = 0) AS files, " +
      "(SELECT f.id FROM board_files f WHERE f.post_id = p.id AND f.image = 1 ORDER BY f.id LIMIT 1) AS thumb " +
      "FROM (SELECT * FROM board_posts p" + (where.length ? " WHERE " + where.join(" AND ") : "") + ` ORDER BY ${order} LIMIT ${PAGE}) p ORDER BY ${order}`,
  )
    .bind(...binds)
    .all<{ id: number; pinned: number; author: string; anon: number }>();
  return json({
    posts: results.map((r) => ({ ...r, author: shownName(env, me, r.author, r.anon), pinned: r.pinned === 1, anon: r.anon === 1, mine: r.author === me.id })),
    more: results.length === PAGE,
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ cat: unknown; title: unknown; body: unknown; anon: unknown }>(request);
  if (!isCat(b.cat)) return json({ error: "게시판을 골라 주세요" }, 400);
  if (!canWrite(me.role, b.cat)) return FORBIDDEN();
  // 익명은 건의 사항만
  const anon = b.anon === true && b.cat === "suggest";
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const body = typeof b.body === "string" ? b.body.replace(/\r\n/g, "\n").trim() : "";
  if (!title || title.length > TITLE_MAX) return json({ error: `제목은 ${TITLE_MAX}자까지 적어 주세요` }, 400);
  if (body.length > BODY_MAX) return json({ error: `내용은 ${BODY_MAX}자까지예요` }, 400);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM board_posts WHERE author = ? AND created_at > ?")
    .bind(me.id, Date.now() - 60_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 3) return json({ error: "잠깐 뒤에 다시 써 주세요" }, 429);
  const row = await env.DB.prepare("INSERT INTO board_posts (cat, author, title, body, created_at, anon) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(b.cat, me.id, title, body, Date.now(), anon ? 1 : 0)
    .first<{ id: number }>();
  if (!row) return json({ error: "글을 올리지 못했어요" }, 500);
  // 공지사항과 이벤트는 모두에게 알린다 (끈 사람 빼고). 건의 사항은 길드마스터·오피서(와 앱개발자)에게 (익명 글은 누가 받든 '익명')
  const lead = body.replace(/\s+/g, " ").trim().slice(0, 90);
  if (b.cat === "notice" || b.cat === "event") {
    await notify(env, "all", "board_notice", `[${CAT_NAME[b.cat]}] ${title} · ${me.id}${lead ? "\n" + lead : ""}`, `#/board/${row.id}`, me.id);
  } else if (b.cat === "suggest") {
    const { results } = await env.DB.prepare("SELECT DISTINCT COALESCE(main_id, id) AS id FROM users WHERE role IN ('developer', 'master', 'officer')").all<{ id: string }>();
    await notify(env, results.map((r) => r.id), "board", `[건의 사항] ${title} · ${anon ? ANON_NAME : me.id}${lead ? "\n" + lead : ""}`, postLink("suggest", row.id), me.id);
  }
  return json({ id: row.id }, 201);
};
