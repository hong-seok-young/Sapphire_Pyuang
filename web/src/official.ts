// 아이모 소식 (제작자 요청 2026-11-01): 아이모 공식 홈페이지(withhive.com)의 공지사항, 점검, 이벤트.
// 서버가 30분마다 받아 둔 것(functions/api/official.ts)을 게시판의 '아이모 소식'에서 보이고, 누르면 앱 안에서 읽는다 (원문은 링크로)
import { api } from "./auth";

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
}

export interface OfficialPost extends OfficialItem {
  /** 간단히 한 본문 HTML (문단, 굵게, 표, 목록, 그림, 링크). 너무 크면 null: 글자(body)만 */
  html: string | null;
  body: string;
}

/** 게시판 '아이모 소식' 안의 칸 */
export const OFFICIAL_TABS: { key: OfficialTab; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "notice", label: "📢 공지사항" },
  { key: "maint", label: "🔧 점검" },
  { key: "event", label: "🎉 이벤트" },
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

export const fetchOfficial = (tab: OfficialTab, before?: number) =>
  api<{ items: OfficialItem[]; more: boolean; checkedAt: number | null }>(`/api/official?tab=${tab}${before ? `&before=${before}` : ""}`);

export const fetchOfficialPost = (id: number) => api<OfficialPost>(`/api/official/${id}`);
