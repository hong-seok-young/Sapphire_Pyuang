// 사용 기록 (앱개발자만 보는 '사용 기록' 화면 #/log, 제작자 요청): 누가, 어디서(앱, 게임 위 창, 웹), 무엇을 했는지.
// 접속(웹이나 앱을 닫았다가 다시 열면 하나), 화면(본 화면 주소), 한 일(API 로 바꾼 것)을 남기고 지우지 않는다 (제작자 요청: 영구 보관).
// 제작자 요청으로 비밀번호만 빼고 모두 남긴다: 보낸 내용(한마디, 흥정 가격, 입찰 금액, 경험치, 챗봇 질문, 토론방 글 ...),
// IP, 대략의 위치(Cloudflare 가 아는 도시), 기기. 사진은 그림 대신 장 수와 크기만 적는다.
import type { Env, User } from "./auth";
import { RANK } from "./auth";
import { notify } from "./alerts";
import { LOG_FULL, advanceLog, currentLog } from "./logdb";

/**
 * 사용 기록을 보는 사람: 길드마스터·앱개발자, 그리고 유어아너 (제작자 2026-11-13 '유어아너도 볼 수 있게').
 * 사람(묶은 캐릭터 모두)으로 정한다. 닉네임을 바꾸면 여기와 화면 src/activity.ts LOG_VIEWERS 를 같이 고친다
 */
export const LOG_VIEWERS = ["유어아너"];
export const canSeeLog = (me: User) => RANK[me.role] >= 2 || (me.chars ?? [me.id]).some((c) => LOG_VIEWERS.includes(c));

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
  /**
   * 기기 표: 브라우저마다 한 번 만든 무작위 글 (화면이 헤더 x-sapphire-dev 로 보낸다, src/auth.ts deviceId).
   * 같은 기기인지 알려고 (제작자 요청 2026-11-02: IP 는 데이터·와이파이만 바꿔도 바뀌어서 다른 사람인지 알 수 없다). 크롬은 폰 모델을 가려 기기 글만으로는 못 가린다
   */
  dev: string | null;
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
    dev: /^[a-z0-9]{8,16}$/.test(request.headers.get("x-sapphire-dev") ?? "") ? request.headers.get("x-sapphire-dev") : null,
  };
}

/**
 * 기록 하나. 접속은 화면이 열릴 때 따로 보낸다 (POST /api/activity { open: true }).
 * 사용 기록 DB 2~10 중 지금 쓰는 곳에 쓴다 (server/logdb.ts). 번호는 DB 를 넘어가도 이어진다. 기록이 안 돼도 하던 일은 그대로 끝난다
 */
export async function record(env: Env, userId: string, kind: Kind, what: string, detail: string | null, where: Where): Promise<void> {
  const { via, ip, place, device, dev } = where;
  try {
    const cur = await currentLog(env);
    const res = await cur.db
      .prepare(
        "INSERT INTO activity (id, user_id, kind, what, detail, via, ip, place, device, dev, at) " +
          "VALUES (COALESCE((SELECT MAX(id) FROM activity), ?) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(cur.base, userId, kind, what.slice(0, 200), detail, via, ip, place, device, dev, Date.now())
      .run();
    const size = (res.meta as { size_after?: number } | undefined)?.size_after;
    if (cur.n === 1) {
      if (size && size > DB_LIMIT * 0.7) await sizeAlarm(env, size);
    } else {
      if (size && size > LOG_LIMIT) await advanceLog(env, cur, (text) => toDeveloper(env, text));
      // 계정 DB(DB 1)는 이제 기록을 쓰지 않아서 50번에 한 번 크기를 본다 (게시판 사진 등이 쌓인다)
      if (Math.random() < 0.02) {
        const main = await env.DB.prepare("SELECT 1").run();
        const mainSize = (main.meta as { size_after?: number } | undefined)?.size_after;
        if (mainSize && mainSize > DB_LIMIT * 0.7) await sizeAlarm(env, mainSize);
      }
    }
  } catch {
    // 기록 실패는 무시한다
  }
}

/** Cloudflare 무료 요금제의 DB 하나 크기 한도 (D1 Free 500MB). 무료로만 쓴다 (제작자 2026-11-02 '무조건 무료로') */
export const DB_LIMIT = 500 * 1024 * 1024;
/** 사용 기록 DB 하나를 이만큼 채우면 다음 DB 로 (server/logdb.ts LOG_FULL) */
const LOG_LIMIT = LOG_FULL;

/**
 * DB 1(계정·글·사진)이 70%, 90% 를 넘으면 앱개발자에게 한 번씩 알린다 (setup 에 적어 두어 한 번만). 그때 사용 기록의 '자세히'로 무엇이 큰지 본다.
 * 사용 기록은 이미 DB 2~10 에 따로 쓴다 (server/logdb.ts)
 */
async function sizeAlarm(env: Env, size: number): Promise<void> {
  const level = size > DB_LIMIT * 0.9 ? 90 : 70;
  const res = await env.DB.prepare("INSERT OR IGNORE INTO setup (key, done_at) VALUES (?, ?)").bind(`db_size_${level}`, Date.now()).run();
  if (!res.meta.changes) return;
  const mb = Math.round(size / 1024 / 1024);
  await toDeveloper(env, `DB 1(계정·글·사진) 저장 공간이 ${level}%를 넘었어요 (${mb}MB / 500MB). 사용 기록의 '자세히'에서 무엇이 큰지 보세요`);
}

/** 앱개발자에게 알림 (DB 크기) */
async function toDeveloper(env: Env, text: string): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id FROM users WHERE role = 'developer' AND main_id IS NULL").all<{ id: string }>();
  await notify(env, results.map((r) => r.id), "account", text, "#/log", "앱");
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
