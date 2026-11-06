// 아이모 소식 (제작자 요청 2026-11-01): 아이모 공식 홈페이지(withhive.com)의 공지사항, 점검, 이벤트.
// 서버가 30분마다 받아 둔 것(functions/api/official.ts)을 게시판의 '아이모 소식'에서 보이고, 누르면 앱 안에서 읽는다 (원문은 링크로)
import { api } from "./auth";
import type { Role } from "./auth";
import type { BoardComment } from "./board";

export type OfficialTab = "all" | "notice" | "maint" | "event";

export interface OfficialItem {
  id: number;
  kind: "notice" | "event";
  /** N 공지사항, C 점검, I 안내, D 오류, E 이벤트 */
  type: string;
  title: string;
  start: string | null;
  end: string | null;
  image: string | null;
  /** 본 사람·좋아요·댓글 수 (제작자 2026-11-06 '일반 게시판이랑 똑같이') */
  views?: number;
  likes?: number;
  comments?: number;
  /** 찾기에서 어디에 맞았는지: 제목, 본문, 그림 속 글자, 비슷한 제목(오타) */
  hit?: "title" | "body" | "image" | "similar";
}

export interface OfficialPost extends Omit<OfficialItem, "comments"> {
  /** 간단히 한 본문 HTML (문단, 굵게, 표, 목록, 그림, 링크). 너무 크면 null: 글자(body)만 */
  html: string | null;
  body: string;
  /** 댓글·좋아요·본 사람 (게시판 글과 같은 모양) */
  comments: BoardComment[];
  liked: boolean;
  roles: Record<string, Role>;
}

/** 게시판 '아이모 소식' 안의 칸 */
export const OFFICIAL_TABS: { key: OfficialTab; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "notice", label: "공지사항" },
  { key: "maint", label: "점검" },
  { key: "event", label: "이벤트" },
];

export const TYPE_NAME: Record<string, string> = { N: "공지", C: "점검", I: "안내", D: "오류", E: "이벤트" };

export const isOfficialTab = (t: string | null): t is OfficialTab => t === "all" || t === "notice" || t === "maint" || t === "event";

/** 공식 페이지 주소 */
export const officialUrl = (it: Pick<OfficialItem, "id" | "kind">) => `https://withhive.com/${it.kind === "event" ? "event" : "notice"}/32/${it.id}`;

/** 공식 글 속 다른 공식 글 링크 -> 앱 안 주소 (아니면 null) */
export function officialLink(href: string): string | null {
  const m = /^https?:\/\/(?:www\.)?withhive\.com\/(?:notice|event)\/32\/(\d+)/.exec(href);
  return m ? `#/official/${m[1]}` : null;
}

export const fetchOfficial = (tab: OfficialTab, before?: number, q?: string) =>
  api<{ items: OfficialItem[]; more: boolean; checkedAt: number | null }>(
    `/api/official?tab=${tab}${before ? `&before=${before}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
  );
/** 모든 글의 제목 (찾은 것이 적을 때 오타로 한 번 더 찾는다). 이번에 연 동안 한 번만 받는다 */
let titles: Promise<OfficialItem[]> | null = null;
export const fetchOfficialTitles = () =>
  (titles ??= api<{ items: OfficialItem[] }>("/api/official?titles=1").then(
    (r) => r.items,
    (e) => {
      titles = null;
      throw e;
    },
  ));

export const fetchOfficialPost = (id: number) => api<OfficialPost>(`/api/official/${id}`);
export const addOfficialComment = (id: number, text: string, parent: number | null) =>
  api<BoardComment>(`/api/official/${id}/comments`, "POST", { text, parent });
export const deleteOfficialComment = (cid: number) => api<{ ok: boolean }>(`/api/official/comments/${cid}`, "DELETE");
export const setOfficialLike = (id: number, on: boolean) => api<{ likes: number; liked: boolean }>(`/api/official/${id}/like`, "PUT", { on });
/** 글의 핵심 요약과 패치노트 직업별 변경점 (처음 연 사람이면 서버가 만든다, 만드는 중이면 pending) */
export interface OfficialSummary {
  lines?: string[];
  jobs?: Record<string, string[]>;
  pending?: boolean;
  none?: boolean;
}
export const fetchOfficialSummary = (id: number) => api<OfficialSummary>(`/api/official/${id}/summary`);
