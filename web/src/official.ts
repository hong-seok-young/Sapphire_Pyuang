// 컴투스 공식 소식 (제작자 요청 2026-11-01): 아이모 공식 홈페이지(withhive.com)의 공지사항, 점검, 이벤트.
// 서버가 30분마다 받아 둔 목록(functions/api/official.ts)을 보이고, 누르면 공식 페이지를 연다. 본문은 챗봇이 읽는다
import { api } from "./auth";

export type OfficialTab = "notice" | "maint" | "event";

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

export const OFFICIAL_TABS: { key: OfficialTab; label: string }[] = [
  { key: "notice", label: "📢 공지사항" },
  { key: "maint", label: "🔧 점검" },
  { key: "event", label: "🎉 이벤트" },
];

export const TYPE_NAME: Record<string, string> = { N: "공지", C: "점검", I: "안내", D: "오류", E: "이벤트" };

export const isOfficialTab = (t: string | null): t is OfficialTab => t === "notice" || t === "maint" || t === "event";

/** 공식 페이지 주소 */
export const officialUrl = (it: Pick<OfficialItem, "id" | "kind">) => `https://withhive.com/${it.kind === "event" ? "event" : "notice"}/32/${it.id}`;

export const fetchOfficial = (tab: OfficialTab, before?: number) =>
  api<{ items: OfficialItem[]; more: boolean; checkedAt: number | null }>(`/api/official?tab=${tab}${before ? `&before=${before}` : ""}`);
