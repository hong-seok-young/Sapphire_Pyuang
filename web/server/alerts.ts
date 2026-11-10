// 알림 (제작자 요청): 내 물건에 살래요, 입찰, 의뢰 수락처럼 나와 관련된 일을 앱 안 알림함(#/alerts)에 남긴다.
// 종류마다 끄고 켤 수 있다 (D1 alert_prefs). 처음엔 모두 켜져 있다 (제작자 2026-11-10 '알림 설정은 다 켜버려', 예전엔 새 물건·새 의뢰가 꺼져 있었다). 지우지 않는다 (제작자 요청 2026-11-01: 기록은 평생. 알림함은 최근 60개만 보인다).
// 폰 자체 알림(웹 푸시)도 같이 보낸다 (server/push.ts, 폰에서 켠 사람만). 게임 위에는 아무것도 띄우지 않는다
import type { Env } from "./auth";
import { pushNew } from "./push";
import { later } from "./background";

/** 알림 종류와 처음 켜짐 여부 (화면 web/src/alerts.ts 의 이름과 같다) */
export const ALERT_KINDS = {
  market_want: true,
  market_bid: true,
  market_outbid: true,
  market_auction: true,
  market_new: true,
  gold_want: true,
  request: true,
  request_new: true,
  talk: true,
  account: true,
  shop: true,
  board: true,
  board_notice: true,
  imo_news: true,
  chat_fixed: true,
  chat_gap: true,
  chat_done: true,
  rent: true,
  todo: true,
  gdungeon: true,
  // 새 기능 알림 (server/appNews.ts, 제작자 요청 2026-11-05)
  app_news: true,
  // 개발 요청 결재선 (server/devreq.ts, 개발중)
  devreq: true,
  // 2군 성장코인샵 (server/gcoin.ts, 개발중): 구매 신청, 지급·반려, 주간 순위 보너스
  gcoin: true,
  // 기부함 (server/donate.ts, 개발중): 기부 신청(운영진에게), 확정·거절·가치 고침(기부한 사람에게)
  donate: true,
  // 생일 축하 (server/birthday.ts, 제작자 2026-11-07 '11월 8일 되는 순간 알림 무조건'): 알림 설정에 줄을 두지 않아 끄지 못한다
  bday: true,
  // 폰 알림 시험 (내 정보 > 알림 설정의 '시험 알림', functions/api/push.ts): 설정에 줄이 없다
  push_test: true,
} as const;
export type AlertKind = keyof typeof ALERT_KINDS;
export const isAlertKind = (k: unknown): k is AlertKind => typeof k === "string" && k in ALERT_KINDS;

/** 알림 보내기. to 가 "all" 이면 모두에게. 보낸 사람과 그 종류를 끈 사람은 빼고 넣는다. 실패해도 하던 일은 그대로 */
export async function notify(env: Env, to: string[] | "all", kind: AlertKind, text: string, link: string | null, from: string): Promise<void> {
  if (to !== "all" && to.length === 0) return;
  try {
    const now = Date.now();
    // 모두에게: 사람마다 한 번 (본캐에게. 부캐 알림은 본캐 알림함에 합쳐 보이므로 캐릭터마다 넣으면 같은 공지가 여러 번 떴다)
    const who = to === "all" ? " AND u.main_id IS NULL" : ` AND u.id IN (${to.map(() => "?").join(",")})`;
    await env.DB.prepare(
      "INSERT INTO alerts (user_id, kind, text, link, created_at) SELECT u.id, ?, ?, ?, ? FROM users u WHERE u.id != ? " +
        "AND COALESCE((SELECT p.enabled FROM alert_prefs p WHERE p.user_id = u.id AND p.kind = ?), ?) = 1" + who,
    )
      .bind(kind, text.slice(0, 200), link, now, from, kind, ALERT_KINDS[kind] ? 1 : 0, ...(to === "all" ? [] : to))
      .run();
    // 폰 알림은 답을 돌려준 뒤에 보낸다 (server/background.ts)
    await later(pushNew(env, kind, now));
  } catch (e) {
    console.error("notify failed", e);
  }
}

/** 강화를 붙인 아이템 이름 */
export const itemName = (r: { item: string; enhance: number }) => `${r.enhance ? `+${r.enhance}` : ""}${r.item}`;
