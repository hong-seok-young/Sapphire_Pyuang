// 게시판 (제작자 요청, 홈의 '장비' 칸 자리): 공지사항, 길드 이벤트, 자유 게시판.
// 글에 사진과 첨부 파일(D1 board_files), 링크(유튜브는 화면이 미리보기, 다른 링크는 /api/board/preview 가 제목과 그림을 읽는다),
// 댓글과 답글(한 단계), 좋아요, 본 사람 수, 공지 고정. 게임과는 상관없는 글이라 게임 안전 규칙에 맞는다.
import { RANK } from "./auth";
import type { Env, Role } from "./auth";

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
}

export async function loadPost(env: Env, id: number): Promise<PostRow | null> {
  return env.DB.prepare("SELECT id, cat, author, title, body, pinned, created_at, edited_at FROM board_posts WHERE id = ?")
    .bind(id)
    .first<PostRow>();
}

/** 글 하나와 거기 딸린 것을 모두 지우는 문장들 */
export function deletePostStmts(env: Env, id: number): D1PreparedStatement[] {
  return [
    env.DB.prepare("DELETE FROM board_files WHERE post_id = ?").bind(id),
    env.DB.prepare("DELETE FROM board_comments WHERE post_id = ?").bind(id),
    env.DB.prepare("DELETE FROM board_likes WHERE post_id = ?").bind(id),
    env.DB.prepare("DELETE FROM board_views WHERE post_id = ?").bind(id),
    env.DB.prepare("DELETE FROM board_posts WHERE id = ?").bind(id),
  ];
}

/** 첨부 이름: 경로 글자를 빼고 100자까지 */
export const cleanName = (n: string) => n.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 100) || "file";
