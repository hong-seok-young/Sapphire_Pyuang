// 알림 (서버 server/alerts.ts, functions/api/alerts): 앱 안 알림함 #/alerts 와 화면 위 🔔 의 안 읽은 수
import { useEffect, useState } from "react";
import { api } from "./auth";
import { GCOIN_OPEN } from "./launcher";

export type AlertKind =
  | "market_want" | "market_bid" | "market_outbid" | "market_auction" | "market_new" | "gold_want" | "request" | "request_new" | "talk" | "account" | "shop"
  | "board" | "board_notice" | "imo_news" | "chat_fixed" | "chat_gap" | "chat_done" | "rent" | "todo" | "gdungeon" | "app_news" | "devreq" | "bday" | "gcoin" | "donate";

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

/**
 * 알림 종류 (내 정보 > 계정 > 알림 설정, pages/AlertSettings.tsx). 묶음 이름은 홈·아래 탭 단추 이름 그대로 (제작자 2026-11-10 '알림 설정 카테고리는 무조건 버튼 명으로,
 * 토론방도 사파이어 중개인 안에 있는 거잖아, 버튼 명에 없는 다른 알림들은 따로 묶어'): 토론방·골드는 사파이어 중개인 안, 건의함 결재는 게시판 댓글과 같은 종류(board),
 * 단추가 없는 계정·새 기능은 맨 아래 '기타'. 종류 이름은 짧은 명사로
 */
export const ALERT_GROUPS: { menu: string; kinds: { kind: AlertKind; name: string; developer?: boolean; preview?: boolean }[] }[] = [
  { menu: "게시판", kinds: [{ kind: "board", name: "내 글 댓글 · 건의 결재" }, { kind: "board_notice", name: "새 공지·이벤트" }, { kind: "imo_news", name: "아이모 소식" }] },
  {
    menu: "사파이어 중개인",
    kinds: [
      { kind: "market_want", name: "살래요" }, { kind: "market_bid", name: "입찰" }, { kind: "market_outbid", name: "입찰 밀림" },
      { kind: "market_auction", name: "경매 전환" }, { kind: "market_new", name: "새 물건" },
      { kind: "talk", name: "토론방 새 글" }, { kind: "gold_want", name: "골드 거래 신청" },
    ],
  },
  { menu: "길드원 의뢰소", kinds: [{ kind: "request", name: "내 의뢰" }, { kind: "request_new", name: "새 의뢰" }] },
  // To do 함께 하는 할 일 (2026-11-02 열었다, server/todo.ts TODO_OPEN)
  { menu: "To do", kinds: [{ kind: "todo", name: "함께 하는 할 일" }] },
  // 길드 던전 (1군 전용, 제작자 요청 2026-11-02): 파티 들어옴, 가능한 때가 다 모임, 확정, 불참
  { menu: "길드 던전", kinds: [{ kind: "gdungeon", name: "파티·시간" }] },
  // 장비대여: 신청, 대여, 마일리지 (2026-11-02 열었다, server/rental.ts RENT_OPEN)
  { menu: "장비대여", kinds: [{ kind: "rent", name: "대여·마일리지" }] },
  { menu: "플래티넘 할인 상점", kinds: [{ kind: "shop", name: "구매 신청·거래" }] },
  {
    menu: "챗봇",
    kinds: [{ kind: "chat_done", name: "답변 완료" }, { kind: "chat_fixed", name: "개선됨" }, { kind: "chat_gap", name: "모르는 질문", developer: true }],
  },
  // 개발 요청 결재선 (server/devreq.ts)
  { menu: "개발 요청", kinds: [{ kind: "devreq", name: "신청·결재" }] },
  // 2군 성장코인샵 (server/gcoin.ts): 구매 신청·지급, 순위 보너스
  { menu: "성장코인샵", kinds: [{ kind: "gcoin", name: "신청·지급", preview: !GCOIN_OPEN }] },
  // 기부함 (server/donate.ts, 개발중, 제작자 2026-11-10): 기부 신청·확정·거절
  { menu: "기부함", kinds: [{ kind: "donate", name: "신청·확정", preview: true }] },
  // 단추가 없는 알림: 역할 바뀜·아이디 생성·계정 삭제 요청(account), 새 기능(server/appNews.ts)
  { menu: "기타", kinds: [{ kind: "account", name: "계정 (역할·요청)" }, { kind: "app_news", name: "새 기능" }] },
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
