// 알림 (서버 server/alerts.ts, functions/api/alerts): 앱 안 알림함 #/alerts 와 화면 위 🔔 의 안 읽은 수
import { useEffect, useState } from "react";
import { api } from "./auth";

export type AlertKind =
  | "market_want" | "market_bid" | "market_outbid" | "market_new" | "gold_want" | "request" | "request_new" | "talk" | "account" | "shop"
  | "board" | "board_notice" | "chat_fixed" | "chat_gap" | "chat_done";

export interface Alert {
  id: number;
  kind: AlertKind;
  text: string;
  link: string | null;
  at: number;
  readAt: number | null;
}

/** 메뉴별 알림 종류 (켜고 끄기 칸). 이름은 짧은 명사로 */
export const ALERT_GROUPS: { menu: string; kinds: { kind: AlertKind; name: string; developer?: boolean }[] }[] = [
  {
    menu: "중개인",
    kinds: [
      { kind: "market_want", name: "살래요" }, { kind: "market_bid", name: "입찰" }, { kind: "market_outbid", name: "입찰 밀림" },
      { kind: "market_new", name: "새 물건" },
    ],
  },
  { menu: "골드", kinds: [{ kind: "gold_want", name: "거래 신청" }] },
  { menu: "의뢰소", kinds: [{ kind: "request", name: "내 의뢰" }, { kind: "request_new", name: "새 의뢰" }] },
  { menu: "토론방", kinds: [{ kind: "talk", name: "새 글" }] },
  { menu: "게시판", kinds: [{ kind: "board", name: "내 글 댓글" }, { kind: "board_notice", name: "새 공지·이벤트" }] },
  { menu: "상점", kinds: [{ kind: "shop", name: "플래티넘 구매" }] },
  {
    menu: "챗봇",
    kinds: [{ kind: "chat_done", name: "답변 완료" }, { kind: "chat_fixed", name: "개선됨" }, { kind: "chat_gap", name: "모르는 질문", developer: true }],
  },
  { menu: "계정", kinds: [{ kind: "account", name: "역할" }] },
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

/** 안 읽은 수를 다시 묻는다 (화면 위 🔔). 실패하면 그대로 둔다 */
export function refreshUnread() {
  api<{ unread: number }>("/api/alerts/count").then((r) => setUnread(r.unread), () => undefined);
}
export const clearUnread = () => setUnread(0);

/** 🔔 의 숫자: 처음, 1분마다, 앱으로 돌아올 때 묻는다 */
export function useUnread(): number {
  const [n, setN] = useState(unread);
  useEffect(() => {
    listeners.add(setN);
    refreshUnread();
    const timer = window.setInterval(refreshUnread, 60_000);
    const onVisible = () => !document.hidden && refreshUnread();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      listeners.delete(setN);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return n;
}
