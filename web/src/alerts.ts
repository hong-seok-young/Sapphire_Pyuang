// 알림 (서버 server/alerts.ts, functions/api/alerts): 앱 안 알림함 #/alerts 와 화면 위 🔔 의 안 읽은 수
import { useEffect, useState } from "react";
import { api } from "./auth";

export type AlertKind =
  | "market_want" | "market_bid" | "market_outbid" | "market_auction" | "market_new" | "gold_want" | "request" | "request_new" | "talk" | "account" | "shop"
  | "board" | "board_notice" | "imo_news" | "chat_fixed" | "chat_gap" | "chat_done" | "rent" | "todo" | "gdungeon" | "app_news" | "devreq" | "bday" | "quest2";

export interface Alert {
  id: number;
  kind: AlertKind;
  text: string;
  link: string | null;
  at: number;
  readAt: number | null;
  /** 묶은 부캐의 알림이면 그 캐릭터 (link 는 그 캐릭터로 바꾸고 여는 #/as/...) */
  who?: string;
}

/** 메뉴별 알림 종류 (켜고 끄기 칸). 이름은 짧은 명사로 */
export const ALERT_GROUPS: { menu: string; kinds: { kind: AlertKind; name: string; developer?: boolean; preview?: boolean }[] }[] = [
  {
    menu: "중개인",
    kinds: [
      { kind: "market_want", name: "살래요" }, { kind: "market_bid", name: "입찰" }, { kind: "market_outbid", name: "입찰 밀림" },
      { kind: "market_auction", name: "경매 전환" },
      { kind: "market_new", name: "새 물건" },
    ],
  },
  { menu: "골드", kinds: [{ kind: "gold_want", name: "거래 신청" }] },
  { menu: "의뢰소", kinds: [{ kind: "request", name: "내 의뢰" }, { kind: "request_new", name: "새 의뢰" }] },
  { menu: "토론방", kinds: [{ kind: "talk", name: "새 글" }] },
  { menu: "게시판", kinds: [{ kind: "board", name: "내 글 댓글" }, { kind: "board_notice", name: "새 공지·이벤트" }, { kind: "imo_news", name: "아이모 소식" }] },
  { menu: "상점", kinds: [{ kind: "shop", name: "플래티넘 구매" }] },
  {
    menu: "챗봇",
    kinds: [{ kind: "chat_done", name: "답변 완료" }, { kind: "chat_fixed", name: "개선됨" }, { kind: "chat_gap", name: "모르는 질문", developer: true }],
  },
  { menu: "계정", kinds: [{ kind: "account", name: "역할" }] },
  // 장비대여: 신청, 대여, 마일리지 (2026-11-02 열었다, server/rental.ts RENT_OPEN)
  { menu: "장비대여", kinds: [{ kind: "rent", name: "대여·마일리지" }] },
  // To do 함께 하는 할 일 (2026-11-02 열었다, server/todo.ts TODO_OPEN)
  { menu: "To do", kinds: [{ kind: "todo", name: "함께" }] },
  // 길드 던전 (1군 전용, 제작자 요청 2026-11-02): 파티 들어옴, 가능한 때가 다 모임, 확정, 불참
  { menu: "길드 던전", kinds: [{ kind: "gdungeon", name: "파티·시간" }] },
  // 새 기능 (server/appNews.ts, 제작자 요청 2026-11-05 '새로운 기능 생겼다고 알림도'): 메뉴를 새로 열면 모두에게 한 번
  { menu: "앱", kinds: [{ kind: "app_news", name: "새 기능" }] },
  // 개발 요청 결재선 (server/devreq.ts)
  { menu: "개발 요청", kinds: [{ kind: "devreq", name: "신청·결재" }] },
  // 2군 성장 퀘스트 (server/quest2.ts, 개발중, 제작자 2026-11-09 '일단 나만 보이게'): 보상받기 신청·지급
  { menu: "2군 성장 퀘스트", kinds: [{ kind: "quest2", name: "신청·지급", developer: true }] },
];

export const fetchAlerts = () =>
  api<{ alerts: Alert[]; unread: number; prefs: Record<AlertKind, boolean>; pushPrefs?: Record<AlertKind, boolean> }>("/api/alerts");
export const readAllAlerts = () => api<{ ok: boolean }>("/api/alerts", "POST");
export const setAlertPref = (kind: AlertKind, on: boolean) => api<{ kind: AlertKind; on: boolean }>("/api/alerts/prefs", "PUT", { kind, on });
/** 그 종류의 폰 알림(푸시)만 켜고 끄기 (앱 알림함은 그대로) */
export const setPushPref = (kind: AlertKind, push: boolean) => api<{ kind: AlertKind; push: boolean }>("/api/alerts/prefs", "PUT", { kind, push });

let unread = 0;
const listeners = new Set<(n: number) => void>();
function setUnread(n: number) {
  unread = n;
  for (const l of listeners) l(n);
}

let lastAsk = 0;
let polling = false;

/** 안 읽은 수를 다시 묻는다 (화면 위 🔔). 실패하면 그대로 둔다 */
export function refreshUnread() {
  lastAsk = Date.now();
  api<{ unread: number }>("/api/alerts/count").then((r) => setUnread(r.unread), () => undefined);
}
export const clearUnread = () => setUnread(0);

/** 🔔 의 숫자: 처음, 1분마다, 앱으로 돌아올 때 묻는다 */
export function useUnread(): number {
  const [n, setN] = useState(unread);
  useEffect(() => {
    listeners.add(setN);
    if (Date.now() - lastAsk > 30_000) refreshUnread();
    if (!polling) {
      polling = true;
      window.setInterval(() => !document.hidden && refreshUnread(), 60_000);
      document.addEventListener("visibilitychange", () => !document.hidden && refreshUnread());
    }
    return () => {
      listeners.delete(setN);
    };
  }, []);
  return n;
}
