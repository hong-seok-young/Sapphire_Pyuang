// 사용 기록 (앱개발자만 보는 '사용 기록' 화면 #/log, 제작자 요청): 누가, 어디서(앱, 게임 위 창, 웹), 무엇을 했는지.
// 접속(30분 넘게 쉬었다가 다시 쓰면 하나), 화면(본 화면 주소), 한 일(API 로 바꾼 것)을 남기고 60일 뒤 지운다.
// 비밀번호, 챗봇 질문, 한마디, 흥정 가격, 입찰 금액, 경험치, 사진처럼 본인이나 상대에게만 보인다고 한 것은 남기지 않는다
// (KEEP 에 있는 칸만 남긴다). 접속한 곳의 IP 나 위치도 남기지 않는다.
import type { Env } from "./auth";

export const KEEP_DAYS = 60;
const DAY = 86_400_000;
/** 이만큼 아무것도 안 하다가 다시 쓰면 접속 하나로 센다 */
const VISIT_GAP = 30 * 60_000;

/** 한 일에서 남기는 칸 (요청 본문). 나머지는 버린다 */
const KEEP = [
  "id", "item", "category", "enhance", "enchant", "enchantValue", "qty", "price", "mode", "hours", "status",
  "side", "gold", "rate", "title", "rewardGold", "rewardText", "action", "job", "level", "guild", "role",
] as const;

export type Kind = "visit" | "view" | "act";
/** 어디서: 안드로이드 앱, 게임 위 위키 창, 웹(아이폰, 안드로이드, PC) */
export type Via = "app" | "float" | "ios" | "android" | "pc";

export function viaOf(request: Request): Via {
  const ua = request.headers.get("user-agent") ?? "";
  if (ua.includes("SapphireFloat")) return "float";
  if (ua.includes("SapphireApp")) return "app";
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "pc";
}

/** 한 일의 짧은 내용: 남겨도 되는 칸만, 그리고 무엇에 했는지(subject) */
export function detailOf(body: unknown, subject: string | null, extra?: Record<string, unknown>): string | null {
  const out: Record<string, unknown> = { ...extra };
  if (body && typeof body === "object") {
    for (const k of KEEP) {
      const v = (body as Record<string, unknown>)[k];
      if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v !== "")) {
        out[k] = typeof v === "string" ? v.slice(0, 60) : v;
      }
    }
  }
  if (subject) out.subject = subject;
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/** 기록 하나. 30분 넘게 쉬었다가 다시 쓰면 접속도 하나 남기고, 가끔 60일 지난 기록을 지운다 */
export async function record(env: Env, userId: string, kind: Kind, what: string, detail: string | null, via: Via): Promise<void> {
  const now = Date.now();
  const stmts = [
    env.DB.prepare(
      "INSERT INTO activity (user_id, kind, what, via, at) SELECT ?1, 'visit', 'open', ?2, ?3 " +
        "WHERE NOT EXISTS (SELECT 1 FROM activity WHERE user_id = ?1 AND at > ?4)",
    ).bind(userId, via, now, now - VISIT_GAP),
  ];
  if (kind !== "visit") {
    stmts.push(
      env.DB.prepare("INSERT INTO activity (user_id, kind, what, detail, via, at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(userId, kind, what.slice(0, 200), detail, via, now),
    );
  }
  if (Math.random() < 0.02) stmts.push(env.DB.prepare("DELETE FROM activity WHERE at < ?").bind(now - KEEP_DAYS * DAY));
  await env.DB.batch(stmts);
}

/** 바꾸는 글의 이름 (지우기 전에 본다): 중개인 물건, 골드 글, 의뢰 */
export async function subjectOf(env: Env, path: string): Promise<string | null> {
  const m = path.match(/^\/api\/(market|gold|requests)\/(\d+)/);
  if (!m) return null;
  const id = Number(m[2]);
  if (m[1] === "market") {
    const r = await env.DB.prepare("SELECT item, enhance, seller FROM listings WHERE id = ?").bind(id)
      .first<{ item: string; enhance: number; seller: string }>();
    return r && `${r.enhance ? `+${r.enhance}` : ""}${r.item} (${r.seller})`;
  }
  if (m[1] === "gold") {
    const r = await env.DB.prepare("SELECT side, gold, owner FROM gold_offers WHERE id = ?").bind(id)
      .first<{ side: string; gold: number; owner: string }>();
    return r && `골드 ${r.side === "sell" ? "팝니다" : "삽니다"} ${r.gold}만 (${r.owner})`;
  }
  const r = await env.DB.prepare("SELECT title, owner FROM requests WHERE id = ?").bind(id).first<{ title: string; owner: string }>();
  return r && `${r.title} (${r.owner})`;
}
