// 게시판 (제작자 요청, 서버 server/board.ts, functions/api/board). 화면 pages/Board.tsx
import { api, ApiError } from "./auth";
import type { Role } from "./auth";

// 건의 사항: 바라는 기능, 고칠 것 (제작자 요청 2026-11-01, 누구나 쓰고 운영진에게 알림)
export type Cat = "notice" | "event" | "free" | "suggest";
export const CATS: Cat[] = ["notice", "event", "free", "suggest"];
export const CAT_NAME: Record<Cat, string> = { notice: "공지사항", event: "길드 이벤트", free: "자유", suggest: "건의 사항" };
export const CAT_ICON: Record<Cat, string> = { notice: "📌", event: "🎉", free: "💬", suggest: "💡" };

export interface PostSummary {
  id: number;
  cat: Cat;
  author: string;
  title: string;
  snippet: string;
  pinned: boolean;
  at: number;
  comments: number;
  likes: number;
  views: number;
  files: number;
  thumb: number | null;
}

export interface BoardFile {
  id: number;
  name: string;
  type: string;
  size: number;
  image: boolean;
}

export interface BoardComment {
  id: number;
  user: string;
  parent: number | null;
  text: string;
  at: number;
}

export interface PostDetail {
  post: { id: number; cat: Cat; author: string; title: string; body: string; pinned: boolean; created_at: number; edited_at: number | null };
  files: BoardFile[];
  comments: BoardComment[];
  likes: number;
  liked: boolean;
  views: number;
  roles: Record<string, Role>;
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site: string | null;
}

export const fileUrl = (id: number) => `/api/board/files/${id}`;

export function fetchPosts(q: { cat?: Cat | null; q?: string; before?: number }) {
  const p = new URLSearchParams();
  if (q.cat) p.set("cat", q.cat);
  if (q.q) p.set("q", q.q);
  if (q.before) p.set("before", String(q.before));
  return api<{ posts: PostSummary[]; more: boolean }>(`/api/board?${p}`);
}
export const fetchPost = (id: number) => api<PostDetail>(`/api/board/${id}`);
export const createPost = (cat: Cat, title: string, body: string) => api<{ id: number }>("/api/board", "POST", { cat, title, body });
export const updatePost = (id: number, p: { title?: string; body?: string; pinned?: boolean }) => api<{ ok: boolean }>(`/api/board/${id}`, "PATCH", p);
export const deletePost = (id: number) => api<{ ok: boolean }>(`/api/board/${id}`, "DELETE");
export const deleteFile = (id: number) => api<{ ok: boolean }>(`/api/board/files/${id}`, "DELETE");
export const addComment = (id: number, text: string, parent: number | null) =>
  api<BoardComment>(`/api/board/${id}/comments`, "POST", { text, parent });
export const deleteComment = (id: number) => api<{ ok: boolean }>(`/api/board/comments/${id}`, "DELETE");
export const setLike = (id: number, on: boolean) => api<{ likes: number; liked: boolean }>(`/api/board/${id}/like`, "PUT", { on });

const previews = new Map<string, Promise<LinkPreview>>();
/** 링크 미리보기 (같은 주소는 한 번만 묻는다) */
export function linkPreview(url: string): Promise<LinkPreview> {
  let p = previews.get(url);
  if (!p) {
    p = api<LinkPreview>(`/api/board/preview?url=${encodeURIComponent(url)}`);
    previews.set(url, p);
  }
  return p;
}

/** 파일 하나 올리기 (본문이 파일 그대로) */
export async function uploadFile(postId: number, file: Blob, name: string): Promise<BoardFile> {
  let res: Response;
  try {
    res = await fetch(`/api/board/${postId}/files`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(name) },
      body: file,
    });
  } catch {
    throw new ApiError(0, "인터넷 연결을 확인해 주세요");
  }
  const data = (await res.json().catch(() => ({}))) as BoardFile & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `파일을 올리지 못했어요 (${res.status})`);
  return data;
}

/** 사진은 긴 변 1600px, JPEG 로 줄여서 올린다 (움직이는 GIF 는 그대로). 1.9MB 를 넘으면 더 줄인다 */
export async function shrinkPhoto(file: File): Promise<{ blob: Blob; name: string }> {
  if (file.type === "image/gif" && file.size <= 1_900_000) return { blob: file, name: file.name };
  const bitmap = await createImageBitmap(file);
  let side = 1600;
  for (let i = 0; i < 4; i++) {
    const k = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bitmap.width * k);
    c.height = Math.round(bitmap.height * k);
    c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
    if (blob && blob.size <= 1_900_000) return { blob, name: file.name.replace(/\.\w+$/, "") + ".jpg" };
    side = Math.round(side * 0.7);
  }
  throw new Error("사진이 너무 커요");
}

export const sizeText = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1000))}KB`);

/** 유튜브 영상 번호 (youtu.be, watch?v=, shorts, live, embed) */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]{6,})/);
      return m?.[2] ?? null;
    }
  } catch {
    // 주소가 아니면 없음
  }
  return null;
}

/** 글 속 주소 (http, https) */
export const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,!?)\]]/g;
