// 사용 기록 (앱개발자만 보는 '사용 기록' 화면 #/log, 서버 functions/api/activity.ts, server/activity.ts).
// 화면이 지금 보는 주소를 알아서 보낸다. 한 일은 서버가 API 요청에서 남긴다.
import { api } from "./auth";
import type { Role } from "./auth";
import type { Wiki } from "./types";

export type Kind = "visit" | "view" | "act";
export type Via = "app" | "float" | "ios" | "android" | "pc";

export interface ActivityRow {
  id: number;
  user: string;
  kind: Kind;
  what: string;
  detail: string | null;
  via: Via | null;
  ip?: string | null;
  place?: string | null;
  device?: string | null;
  at: number;
}

export interface Person {
  id: string;
  role: Role;
  visits7: number;
  visits30: number;
  views7: number;
  acts7: number;
  last: number | null;
  lastVia: Via | null;
}

export const VIA_NAME: Record<Via, string> = {
  app: "앱",
  float: "게임 위 창",
  ios: "웹(아이폰)",
  android: "웹(안드로이드)",
  pc: "웹(PC)",
};

export const KIND_NAME: Record<Kind, string> = { visit: "접속", view: "화면", act: "한 일" };

export function fetchActivity(q: { user?: string | null; kind?: Kind | null; before?: number }) {
  const p = new URLSearchParams();
  if (q.user) p.set("user", q.user);
  if (q.kind) p.set("kind", q.kind);
  if (q.before) p.set("before", String(q.before));
  return api<{ rows: ActivityRow[]; more: boolean; people?: Person[]; keepDays?: number }>(`/api/activity?${p}`);
}

let lastSent = "";
let timer = 0;

/** 지금 보는 화면을 남긴다: 한 화면에 1.5초 넘게 있을 때만, 같은 화면은 잇달아 보내지 않는다 */
export function reportView(hash: string) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const path = hash.startsWith("#/") ? hash : "#/";
    if (path === lastSent) return;
    lastSent = path;
    fetch("/api/activity", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: path.slice(0, 200) }),
      keepalive: true,
    }).catch(() => {});
  }, 1500);
}

/** 다른 앱에 오래 있다가 돌아오면 같은 화면이라도 다시 보낸다 (접속을 세려고) */
export function forgetView() {
  lastSent = "";
}

const PAGE_NAME: Record<string, string> = {
  "": "홈", places: "사냥터 목록", search: "검색", equip: "장비", chat: "챗봇", ranking: "길드 랭킹", market: "사파이어 중개인",
  requests: "길드원 의뢰소", alerts: "알림", shop: "플래티넘 할인 상점", me: "내 정보", admin: "길드원 관리", app: "앱", password: "비밀번호 바꾸기", log: "사용 기록",
};

/** 화면 주소를 이름으로: 글은 제목, 사냥터와 몬스터는 이름 */
export function pageName(path: string, wiki: Wiki): string {
  const [raw, query = ""] = path.replace(/^#\/?/, "").split("?");
  const [page = "", arg = ""] = raw.split("/").map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  if (page === "post") {
    for (const s of wiki.menu) for (const p of s.posts) if (p.id === arg) return `글: ${p.title}`;
    return `글 ${arg}`;
  }
  if (page === "place") return `사냥터: ${wiki.places[arg]?.name ?? arg}`;
  if (page === "monster") return `몬스터: ${wiki.monsters[arg]?.name ?? arg}`;
  if (page === "item") return `아이템: ${arg}`;
  if (page === "menu") return `메뉴: ${arg}`;
  if (page === "equip" && arg) return `장비: ${arg}`;
  if (page === "search") {
    const q = new URLSearchParams(query).get("q");
    return q ? `검색: ${q}` : "검색";
  }
  if (page === "places") {
    const r = new URLSearchParams(query).get("r");
    return r ? `사냥터 목록: ${r}` : "사냥터 목록";
  }
  return PAGE_NAME[page] ?? path;
}

/** 한 일의 이름 (메서드와 경로) */
const ACTIONS: [RegExp, string][] = [
  [/^POST \/api\/login$/, "로그인"],
  [/^POST \/api\/logout$/, "로그아웃"],
  [/^POST \/api\/password$/, "비밀번호 바꿈"],
  [/^PUT \/api\/profile$/, "직업·레벨 저장"],
  [/^PUT \/api\/avatar$/, "캐릭터 사진 올림"],
  [/^DELETE \/api\/avatar$/, "캐릭터 사진 지움"],
  [/^POST \/api\/chat$/, "챗봇에 질문"],
  [/^POST \/api\/users$/, "계정 만듦"],
  [/^DELETE \/api\/users\/([^/]+)$/, "계정 지움: $1"],
  [/^PATCH \/api\/users\/([^/]+)$/, "역할 바꿈: $1"],
  [/^POST \/api\/users\/([^/]+)\/reset$/, "비밀번호 초기화: $1"],
  [/^POST \/api\/users\/([^/]+)\/rename$/, "닉네임 바꿈: $1"],
  [/^PUT \/api\/users\/([^/]+)\/profile$/, "직업·레벨 고침: $1"],
  [/^DELETE \/api\/users\/([^/]+)\/avatar$/, "사진 내림: $1"],
  [/^POST \/api\/market$/, "중개인 물건 올림"],
  [/^PATCH \/api\/market\/\d+$/, "중개인 글 고침"],
  [/^DELETE \/api\/market\/\d+$/, "중개인 글 내림"],
  [/^PUT \/api\/market\/\d+\/want$/, "중개인 살래요"],
  [/^DELETE \/api\/market\/\d+\/want$/, "중개인 살래요 취소"],
  [/^POST \/api\/market\/\d+\/bids$/, "중개인 경매 입찰"],
  [/^POST \/api\/gold$/, "골드 글 올림"],
  [/^PATCH \/api\/gold\/\d+$/, "골드 글 고침"],
  [/^DELETE \/api\/gold\/\d+$/, "골드 글 내림"],
  [/^PUT \/api\/gold\/\d+\/want$/, "골드 거래할래요"],
  [/^DELETE \/api\/gold\/\d+\/want$/, "골드 거래할래요 취소"],
  [/^POST \/api\/requests$/, "의뢰 올림"],
  [/^POST \/api\/shop\/orders$/, "플래티넘 구매 신청"],
  [/^PATCH \/api\/shop\/orders\/\d+$/, "플래티넘 신청 처리"],
  [/^PUT \/api\/shop$/, "플래티넘 상점 설정"],
  [/^PUT \/api\/shop\/items\/(.+)$/, "플래티넘 물건 설정: $1"],
  [/^POST \/api\/market\/\d+\/talk$/, "토론방 글"],
  [/^DELETE \/api\/market\/\d+\/talk\/\d+$/, "토론방 글 지움"],
  [/^PUT \/api\/users\/([^/]+)\/highspec$/, "고스펙 표시: $1"],
  [/^PUT \/api\/alerts\/prefs$/, "알림 설정"],
  [/^POST \/api\/dev\/switch$/, "테스트 계정 전환"],
  [/^PATCH \/api\/requests\/\d+$/, "의뢰"],
  [/^DELETE \/api\/requests\/\d+$/, "의뢰 내림"],
];

const STATUS: Record<string, string> = { sold: "거래 완료", selling: "다시 판매", done: "끝냄", open: "다시 엶" };
const JOB: Record<string, string> = { warrior: "전사", ranger: "레인저", mage: "마법사", monk: "무도가" };
const ROLE: Record<string, string> = { master: "길드마스터", officer: "오피서", member: "길드원" };
const REQUEST_ACTION: Record<string, string> = { accept: "수락", giveup: "포기", release: "수락 취소", done: "완료", reopen: "다시 모집" };

/** 위에서 따로 읽지 않는 칸의 이름 (비밀번호는 서버가 남기지 않는다) */
const FIELD: Record<string, string> = {
  note: "한마디", text: "글", offer: "흥정", amount: "입찰", exp: "경험치", question: "질문", photos: "사진", size: "크기",
  parent: "답글", on: "켬", enabled: "판매", ratio: "1군 비율", highRatio: "고스펙 비율", market: "시중 비율",
  limitCount: "한도 개수", limitWeeks: "한도 주", open: "오픈", itemId: "물건", kind: "종류", to: "대상", qty: "수량",
  category: "종류", enchant: "속성", enchantValue: "속성 값", options: "옵션", rewardGold: "보상 골드", rewardText: "보상",
  failed: "실패",
};
/** actionText 가 이미 읽는 칸 */
const READ = new Set(["item", "enhance", "subject", "title", "price", "mode", "hours", "gold", "side", "rate", "status", "action", "id", "role", "job", "level", "guild", "newId", "fresh"]);

function fieldText(k: string, v: unknown): string {
  const name = FIELD[k] ?? k;
  if (k === "exp" && typeof v === "number") return `경험치 ${(v / 1000).toFixed(3)}%`;
  if ((k === "offer" || k === "amount") && typeof v === "number") return `${name} ${v.toLocaleString("ko-KR")} 골드`;
  if (k === "photos" && typeof v === "number") return `사진 ${v}장`;
  if (k === "failed") return `실패 (${String(v)})`;
  if (typeof v === "boolean") return v ? name : `${name} 아님`;
  if (typeof v === "string") return `${name} “${v}”`;
  return `${name} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`;
}

/** 한 일을 읽는 글로: '중개인 경매 입찰 · +8헌터보우 (판매왕) · 입찰 1,600 골드' */
export function actionText(what: string, detail: string | null): string {
  let name = what;
  for (const [re, label] of ACTIONS) {
    if (re.test(what)) {
      name = what.replace(re, label);
      break;
    }
  }
  let d: Record<string, unknown> = {};
  try {
    d = detail ? (JSON.parse(detail) as Record<string, unknown>) : {};
  } catch {
    // 모양이 다르면 이름만
  }
  const bits: string[] = [];
  if (typeof d.item === "string") bits.push(`${d.enhance ? `+${d.enhance}` : ""}${d.item}`);
  if (typeof d.subject === "string") bits.push(d.subject);
  if (typeof d.title === "string") bits.push(`“${d.title}”`);
  if (typeof d.price === "number") bits.push(`${d.price.toLocaleString("ko-KR")} 골드${d.mode === "auction" ? ` 경매 ${d.hours}시간` : ""}`);
  if (typeof d.gold === "number") bits.push(`${d.side === "buy" ? "삽니다" : d.side === "sell" ? "팝니다" : ""} ${d.gold}만 골드`.trim());
  if (typeof d.rate === "number") bits.push(`${d.rate}:1`);
  if (typeof d.status === "string") bits.push(STATUS[d.status] ?? d.status);
  if (typeof d.action === "string") bits.push(REQUEST_ACTION[d.action] ?? d.action);
  if (typeof d.id === "string") bits.push(d.id);
  if (typeof d.role === "string") bits.push(ROLE[d.role] ?? d.role);
  if (typeof d.job === "string") bits.push(JOB[d.job] ?? d.job);
  if (typeof d.level === "number") bits.push(`Lv.${d.level}`);
  if (d.guild === "main" || d.guild === "second") bits.push(d.guild === "main" ? "1군" : "2군");
  if (typeof d.newId === "string") bits.push(`→ ${d.newId}${d.fresh ? " (다른 캐릭터, 성장 새로)" : ""}`);
  // 나머지 칸도 모두 (제작자 요청: 비밀번호 빼고 다 본다)
  for (const [k, v] of Object.entries(d)) if (!READ.has(k) && v !== null && v !== "") bits.push(fieldText(k, v));
  return bits.length ? `${name} · ${bits.join(" · ")}` : name;
}
