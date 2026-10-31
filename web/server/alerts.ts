// 알림 (제작자 요청): 내 물건에 살래요, 입찰, 의뢰 수락처럼 나와 관련된 일을 앱 안 알림함(#/alerts)에 남긴다.
// 종류마다 끄고 켤 수 있다 (D1 alert_prefs). 새 물건, 새 의뢰처럼 많은 것은 처음엔 꺼져 있다. 30일 뒤 지운다.
// 폰 푸시나 게임 위 알림이 아니다 (게임 위에 아무것도 띄우지 않는다)
import type { Env } from "./auth";

/** 알림 종류와 처음 켜짐 여부 (화면 web/src/alerts.ts 의 이름과 같다) */
export const ALERT_KINDS = {
  market_want: true,
  market_bid: true,
  market_outbid: true,
  market_new: false,
  gold_want: true,
  request: true,
  request_new: false,
  talk: true,
  account: true,
  shop: true,
} as const;
export type AlertKind = keyof typeof ALERT_KINDS;
export const isAlertKind = (k: unknown): k is AlertKind => typeof k === "string" && k in ALERT_KINDS;

const KEEP_MS = 30 * 86_400_000;

/** 알림 보내기. to 가 "all" 이면 모두에게. 보낸 사람과 그 종류를 끈 사람은 빼고 넣는다. 실패해도 하던 일은 그대로 */
export async function notify(env: Env, to: string[] | "all", kind: AlertKind, text: string, link: string | null, from: string): Promise<void> {
  if (to !== "all" && to.length === 0) return;
  try {
    const now = Date.now();
    const who = to === "all" ? "" : ` AND u.id IN (${to.map(() => "?").join(",")})`;
    await env.DB.prepare(
      "INSERT INTO alerts (user_id, kind, text, link, created_at) SELECT u.id, ?, ?, ?, ? FROM users u WHERE u.id != ? " +
        "AND COALESCE((SELECT p.enabled FROM alert_prefs p WHERE p.user_id = u.id AND p.kind = ?), ?) = 1" + who,
    )
      .bind(kind, text.slice(0, 120), link, now, from, kind, ALERT_KINDS[kind] ? 1 : 0, ...(to === "all" ? [] : to))
      .run();
    if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM alerts WHERE created_at < ?").bind(now - KEEP_MS).run();
  } catch (e) {
    console.error("notify failed", e);
  }
}

/** 강화를 붙인 아이템 이름 */
export const itemName = (r: { item: string; enhance: number }) => `${r.enhance ? `+${r.enhance}` : ""}${r.item}`;
