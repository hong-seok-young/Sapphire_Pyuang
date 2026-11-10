// 게시판 (제작자 요청, 홈의 '장비' 칸 자리): 공지사항, 길드 이벤트, 자유 게시판.
// 글에 사진과 첨부 파일(D1 board_files), 링크(유튜브는 화면이 미리보기, 다른 링크는 /api/board/preview 가 제목과 그림을 읽는다),
// 댓글과 답글(한 단계), 좋아요, 본 사람 수, 공지 고정. 게임과는 상관없는 글이라 게임 안전 규칙에 맞는다.
import { RANK } from "./auth";
import type { Env, Role, User } from "./auth";

export const CATS = ["notice", "event", "free", "suggest"] as const;
export type Cat = (typeof CATS)[number];
export const isCat = (c: unknown): c is Cat => typeof c === "string" && (CATS as readonly string[]).includes(c);
export const CAT_NAME: Record<Cat, string> = { notice: "공지사항", event: "길드 이벤트", free: "자유", suggest: "건의 사항" };

/** 공지사항과 이벤트는 오피서 이상만 쓴다. 자유 게시판과 건의 사항은 누구나 */
export const canWrite = (role: Role, cat: Cat) => cat === "free" || cat === "suggest" || RANK[role] >= 1;
/** 글 지우기, 고정: 쓴 사람(지우기만) 또는 오피서 이상 */
export const isStaff = (role: Role) => RANK[role] >= 1;

export const TITLE_MAX = 80;
export const BODY_MAX = 10_000;
export const COMMENT_MAX = 500;
export const FILES_MAX = 10;
/** D1 한 칸이 2MB 까지라 조금 작게. 사진은 화면이 줄여서 보낸다 */
export const FILE_MAX_BYTES = 1_900_000;
/** 그림으로 보여 주는 형식 (나머지는 내려받기 파일로만) */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export interface PostRow {
  id: number;
  cat: Cat;
  author: string;
  title: string;
  body: string;
  pinned: number;
  created_at: number;
  edited_at: number | null;
  anon: number;
}

export async function loadPost(env: Env, id: number): Promise<PostRow | null> {
  return env.DB.prepare("SELECT id, cat, author, title, body, pinned, created_at, edited_at, anon FROM board_posts WHERE id = ?")
    .bind(id)
    .first<PostRow>();
}

/** 글 하나와 거기 딸린 것을 모두 지우는 문장들 */
export function deletePostStmts(env: Env, id: number): D1PreparedStatement[] {
  return [
    env.DB.prepare("DELETE FROM board_files WHERE post_id = ?").bind(id),
    env.DB.prepare("DELETE FROM board_comments WHERE post_id = ?").bind(id),
    env.DB.prepare("DELETE FROM suggest_steps WHERE post_id = ?").bind(id),
    env.DB.prepare("DELETE FROM board_likes WHERE post_id = ?").bind(id),
    env.DB.prepare("DELETE FROM board_views WHERE post_id = ?").bind(id),
    env.DB.prepare("DELETE FROM board_posts WHERE id = ?").bind(id),
  ];
}

/** 첨부 이름: 경로 글자를 빼고 100자까지 */
export const cleanName = (n: string) => n.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 100) || "file";

// ---------- 건의함 (제작자 요청 2026-11-09) ----------
// 건의함(#/suggest, 화면 pages/Board.tsx SuggestPage)은 게시판의 건의 사항(cat 'suggest')을 그대로 쓴다. 글과 댓글을 익명(board_posts.anon, board_comments.anon)으로 올릴 수 있다.

/**
 * 건의함 오픈 (화면 src/board.ts 의 SUGGEST_OPEN 과 같이 바꾼다): false 인 동안 게시판에 '건의 사항' 칸이 그대로 있고 건의함은 개발 중(미리 보는 사람만).
 * true 면 게시판 '전체'에서 건의 글을 빼고, 건의 알림이 건의함 글로 간다
 */
export const SUGGEST_OPEN = true;

/** 익명이라고 보일 이름 */
export const ANON_NAME = "익명";
/**
 * 익명 글·댓글을 쓴 사람이 누구인지 보는지: Pages 비밀값 ANON_VIEWERS(쉼표로 이은 닉네임, 묶은 캐릭터 중 하나라도)에 든 사람만.
 * 누구인지는 공개 저장소에 적지 않는다 (배포가 비공개 자료에서 넣는다, deploy-web.yml). 비밀값이 없으면 아무도 못 본다
 */
export const canSeeAnon = (env: Env, me: User) => {
  const list = (env.ANON_VIEWERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 && (me.chars ?? [me.id]).some((c) => list.includes(c));
};
/** 익명이고 볼 수 없는 사람이면 '익명' */
export const shownName = (env: Env, me: User, name: string, anon: number | boolean | null | undefined) => (anon && !canSeeAnon(env, me) ? ANON_NAME : name);

/** 건의 사항 글을 모두 보는 사람: 오피서 이상 (앱개발자 포함, 제작자 2026-11-10). 다른 사람은 내가 쓴 건의만 본다 */
export const seesAllSuggest = (me: User) => isStaff(me.role);
/** 이 글을 볼 수 있는지 (건의 사항은 운영진과 쓴 사람만) */
export const canSeePost = (me: User, post: { cat: string; author: string }) =>
  post.cat !== "suggest" || seesAllSuggest(me) || (me.chars ?? [me.id]).includes(post.author);
/** SQL 조건 (별칭 p 의 board_posts): 이 사람에게 보이는 글. 모두 보면 빈 조건 */
export function visiblePosts(me: User, alias = "p"): { sql: string; binds: string[] } {
  if (seesAllSuggest(me)) return { sql: "", binds: [] };
  const chars = me.chars?.length ? me.chars : [me.id];
  return { sql: `(${alias}.cat != 'suggest' OR ${alias}.author IN (${chars.map(() => "?").join(", ")}))`, binds: chars };
}
/** 그 건의 글·댓글의 주소 (건의함을 열면 건의함으로) */
export const postLink = (cat: string, id: number) => (SUGGEST_OPEN && cat === "suggest" ? `#/suggest/${id}` : `#/board/${id}`);

/**
 * 사용 기록에 남기지 않을 일인지 (길드마스터가 사용 기록으로 익명 글쓴이를 알아내지 못하게): 익명 글·댓글 쓰기, 내 익명 글 고치기·지우기·사진 올리기,
 * 내 익명 댓글 지우기. 화면 보기는 functions/api/activity.ts 가 anonView 로 거른다
 */
export async function anonWrite(env: Env, me: User, method: string, path: string, body: unknown): Promise<boolean> {
  if (!path.startsWith("/api/board")) return false;
  const b = body as { anon?: unknown; cat?: unknown } | null;
  const anon = b?.anon === true;
  // 익명은 건의 사항에만 된다 (다른 칸 글에 anon 을 보내도 실명이라 그대로 남긴다)
  if (method === "POST" && path === "/api/board") return anon && b?.cat === "suggest";
  let m = /^\/api\/board\/(\d+)\/comments$/.exec(path);
  if (method === "POST" && m)
    return anon && !!(await env.DB.prepare("SELECT 1 AS x FROM board_posts WHERE id = ? AND cat = 'suggest'").bind(Number(m[1])).first());
  m = /^\/api\/board\/(\d+)(?:\/|$)/.exec(path);
  if (m) return !!(await env.DB.prepare("SELECT 1 AS x FROM board_posts WHERE id = ? AND anon = 1 AND author = ?").bind(Number(m[1]), me.id).first());
  m = /^\/api\/board\/files\/(\d+)$/.exec(path);
  if (m)
    return !!(await env.DB.prepare("SELECT 1 AS x FROM board_files f JOIN board_posts p ON p.id = f.post_id WHERE f.id = ? AND p.anon = 1 AND p.author = ?")
      .bind(Number(m[1]), me.id)
      .first());
  m = /^\/api\/board\/comments\/(\d+)$/.exec(path);
  if (m) return !!(await env.DB.prepare("SELECT 1 AS x FROM board_comments WHERE id = ? AND anon = 1 AND user_id = ?").bind(Number(m[1]), me.id).first());
  return false;
}

/** 사용 기록에 남기지 않을 화면인지: 내 익명 글(과 그 수정 화면), 건의함 글쓰기 화면 */
export async function anonView(env: Env, me: User, path: string): Promise<boolean> {
  if (/^#\/suggest\/write(?:$|[?/])/.test(path) || /^#\/board\/write\?(?:.*&)?cat=suggest/.test(path)) return true;
  const m = /^#\/(?:board|suggest)\/(\d+)(?:$|[/?])/.exec(path);
  if (!m) return false;
  return !!(await env.DB.prepare("SELECT 1 AS x FROM board_posts WHERE id = ? AND anon = 1 AND author = ?").bind(Number(m[1]), me.id).first());
}
