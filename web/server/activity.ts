// 사용 기록 (앱개발자만 보는 '사용 기록' 화면 #/log, 제작자 요청): 누가, 어디서(앱, 게임 위 창, 웹), 무엇을 했는지.
// 접속(웹이나 앱을 닫았다가 다시 열면 하나), 화면(본 화면 주소), 한 일(API 로 바꾼 것)을 남기고 지우지 않는다 (제작자 요청: 영구 보관).
// 제작자 요청으로 비밀번호만 빼고 모두 남긴다: 보낸 내용(한마디, 흥정 가격, 입찰 금액, 경험치, 챗봇 질문, 토론방 글 ...),
// IP, 대략의 위치(Cloudflare 가 아는 도시), 기기. 사진은 그림 대신 장 수와 크기만 적는다.
import type { Env } from "./auth";

/** 남기지 않는 칸: 비밀번호 (로그인, 계정 만들기, 초기화의 password, 비밀번호 바꾸기의 current, next) */
const SECRET = /pass|^current$|^next$/i;
/** 챗봇에 같이 보내는 위키 자료는 길고 질문이 아니라서 뺀다 */
const SKIP = new Set(["context"]);
const MAX_TEXT = 1000;

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

/** 긴 그림 데이터(base64)는 크기만, 글은 1000자까지 */
function plain(v: unknown): unknown {
  if (typeof v === "string") {
    const picture = v.length > 2000 && /^[A-Za-z0-9+/=]+$/.test(v.slice(0, 200));
    return picture ? `[그림 ${Math.round((v.length * 3) / 4 / 1024)}KB]` : v.slice(0, MAX_TEXT);
  }
  if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
  const s = JSON.stringify(v);
  return s && s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + "…" : v;
}

/** 챗봇 질문: 마지막 질문 글과 사진 장 수 */
function chatQuestion(messages: unknown): Record<string, unknown> {
  if (!Array.isArray(messages) || !messages.length) return {};
  const last = messages[messages.length - 1] as { text?: unknown; images?: unknown };
  return {
    question: typeof last?.text === "string" ? last.text.slice(0, MAX_TEXT) : "",
    ...(Array.isArray(last?.images) && last.images.length ? { photos: last.images.length } : {}),
  };
}

/** 한 일의 내용: 보낸 본문 전부(비밀번호 빼고), 그리고 무엇에 했는지(subject) */
export function detailOf(body: unknown, subject: string | null): string | null {
  const out: Record<string, unknown> = {};
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (SECRET.test(k) || SKIP.has(k) || v === undefined || v === "") continue;
      if (k === "messages") Object.assign(out, chatQuestion(v));
      else out[k] = plain(v);
    }
  }
  if (subject) out.subject = subject;
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/** 접속한 곳: 앱/웹, IP, Cloudflare 가 아는 도시와 나라, 기기 (User-Agent 에서) */
export interface Where {
  via: Via;
  ip: string | null;
  place: string | null;
  device: string | null;
}

function deviceOf(ua: string): string | null {
  const app = ua.match(/SapphireApp\/([\w.]+)/)?.[1];
  const android = ua.match(/Android ([\d.]+)(?:; ([^;)]+))?/);
  const ios = ua.match(/(iPhone|iPad)[^)]*OS ([\d_]+)/);
  const browser = /SamsungBrowser/.test(ua)
    ? "삼성 인터넷"
    : /CriOS|Chrome/.test(ua)
      ? "크롬"
      : /Firefox|FxiOS/.test(ua)
        ? "파이어폭스"
        : /Safari/.test(ua)
          ? "사파리"
          : null;
  const parts: string[] = [];
  // 크롬은 기기 이름을 'K' 로 가린다. 앱(WebView)의 'wv' 도 이름이 아니다
  const model = android?.[2]?.trim();
  if (android) parts.push(`안드로이드 ${android[1]}${model && model !== "K" && model !== "wv" ? ` ${model}` : ""}`);
  else if (ios) parts.push(`${ios[1]} iOS ${ios[2].replace(/_/g, ".")}`);
  else if (/Windows/.test(ua)) parts.push("윈도우");
  else if (/Mac OS X/.test(ua)) parts.push("맥");
  if (app) parts.push(`앱 ${app}`);
  else if (browser) parts.push(browser);
  return parts.length ? parts.join(" · ").slice(0, 80) : ua.slice(0, 80) || null;
}

export function whereOf(request: Request): Where {
  const cf = (request as Request & { cf?: { city?: unknown; region?: unknown; country?: unknown } }).cf;
  const place = [cf?.city, cf?.region, cf?.country].filter((x): x is string => typeof x === "string" && x !== "").join(", ");
  return {
    via: viaOf(request),
    ip: request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for"),
    place: place || null,
    device: deviceOf(request.headers.get("user-agent") ?? ""),
  };
}

/** 기록 하나. 접속은 화면이 열릴 때 따로 보낸다 (POST /api/activity { open: true }) */
export async function record(env: Env, userId: string, kind: Kind, what: string, detail: string | null, where: Where): Promise<void> {
  const { via, ip, place, device } = where;
  await env.DB.prepare("INSERT INTO activity (user_id, kind, what, detail, via, ip, place, device, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(userId, kind, what.slice(0, 200), detail, via, ip, place, device, Date.now())
    .run();
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
