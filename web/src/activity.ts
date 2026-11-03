// 사용 기록 (앱개발자만 보는 '사용 기록' 화면 #/log, 서버 functions/api/activity.ts, server/activity.ts).
// 화면이 지금 보는 주소를 알아서 보낸다. 한 일은 서버가 API 요청에서 남긴다.
import { api, apiHeaders } from "./auth";
import type { Role } from "./auth";
import type { Wiki } from "./types";
import { CAT_NAME } from "./board";
import { ITEMS } from "./launcher";
import { slotText } from "./gdungeon";
import { weekStart } from "./week";
import type { Cat } from "./board";

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
  /** 같은 사람의 부캐 (부캐 묶기: 기록을 본캐 한 줄로 합친다) */
  alts?: string[];
  /** 7일 동안 쓴 기기 수 (기기 표로 센다, 2026-11-02 부터) */
  devices7: number;
  /** 7일 안에 처음 나온 기기 (전에 쓰던 다른 기기가 있을 때만) */
  newDev: boolean;
  /** 7일 동안 같은 때(10분 안) 다른 기기가 다른 도시에서 쓴 번 수 (화면은 '다른 도시 동시 접속 N번') */
  together: number;
}

/** 고른 사람의 겹친 접속 하나 (60일): 기기 a 가 도시 a 에서 쓴 지 10분 안에 다른 기기 b 가 다른 도시 b 에서 */
export interface OverlapInfo {
  at: number;
  a: { name: string | null; city: string; char: string };
  b: { name: string | null; city: string; char: string };
}

/** 고른 사람의 기기 하나 (최근 60일, 같은 기기는 캐릭터를 합쳐서) */
export interface DeviceInfo {
  /** 기기와 브라우저 ('안드로이드 14 SM-S928N · 삼성 인터넷'. 크롬은 폰 모델을 가린다) */
  name: string | null;
  /** 기기 표가 생기기 전 기록 (기기 글로만 묶음) */
  legacy: boolean;
  first: number;
  last: number;
  visits: number;
  n: number;
  cities: string[];
  chars: string[];
  isNew: boolean;
}

export const VIA_NAME: Record<Via, string> = {
  app: "앱",
  float: "게임 위 창",
  ios: "웹(아이폰)",
  android: "웹(안드로이드)",
  pc: "웹(PC)",
};

export const KIND_NAME: Record<Kind, string> = { visit: "접속", view: "화면", act: "한 일" };

/** DB 를 무엇이 얼마나 쓰는지 (사용 기록의 '자세히', 앱개발자만) */
export const fetchUsage = () => api<{ total: number | null; limit: number; parts: { name: string; bytes: number }[] }>("/api/activity?usage=1");

/** 사용 기록 DB 2~10 하나 (server/logdb.ts): 크기, 남은 기록 수, 쓰기 시작한 때, 지금 쓰는 곳 */
export interface LogDbInfo {
  n: number;
  bytes: number | null;
  rows: number;
  since: number | null;
  cur: boolean;
}
export interface Storage {
  rows: number;
  /** DB 1 (계정·글·사진) 크기 */
  bytes: number | null;
  logs?: LogDbInfo[];
  /** 사용 기록 DB 하나를 이만큼 채우면 다음 DB 로 */
  logFull?: number;
}

export function fetchActivity(q: { user?: string | null; kind?: Kind | null; before?: number }) {
  const p = new URLSearchParams();
  if (q.user) p.set("user", q.user);
  if (q.kind) p.set("kind", q.kind);
  if (q.before) p.set("before", String(q.before));
  return api<{ rows: ActivityRow[]; more: boolean; people?: Person[]; devices?: DeviceInfo[]; overlaps?: OverlapInfo[]; storage?: Storage }>(
    `/api/activity?${p}`,
  );
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
      headers: apiHeaders(true),
      body: JSON.stringify({ path: path.slice(0, 200) }),
      keepalive: true,
    }).catch(() => {});
  }, 1500);
}

const OPENED = "sapphire-opened";
let opened = "";

/**
 * 접속 (제작자 요청): 웹이나 앱을 닫았다가 다시 열었을 때만 하나 센다. 다른 앱에 갔다 오거나, 새로고침,
 * 업데이트로 다시 뜬 것은 세지 않는다. sessionStorage 는 창(탭)을 닫을 때까지 남아서 이번 열기에 보냈는지 안다.
 * 로그아웃 뒤 다른 닉네임으로 들어오면 그 사람 접속으로 하나 더 센다.
 */
export function reportOpen(userId: string) {
  if (opened === userId) return;
  opened = userId;
  try {
    if (sessionStorage.getItem(OPENED) === userId) return;
    sessionStorage.setItem(OPENED, userId);
  } catch {
    // 못 적으면 이 페이지가 떠 있는 동안 한 번만 센다
  }
  fetch("/api/activity", {
    method: "POST",
    credentials: "same-origin",
    headers: apiHeaders(true),
    body: JSON.stringify({ open: true }),
    keepalive: true,
  }).catch(() => {});
}

const PAGE_NAME: Record<string, string> = {
  "": "홈", places: "사냥터 목록", search: "검색", equip: "장비", chat: "챗봇", ranking: "길드 랭킹", market: "사파이어 중개인",
  requests: "길드원 의뢰소", alerts: "알림", shop: "플래티넘 할인 상점", board: "게시판", me: "내 정보", admin: "길드원 관리", app: "앱", password: "비밀번호 바꾸기", log: "사용 기록", patch: "패치 내역", odds: "공식 확률",
  match: "길드 던전", todo: "To do", rent: "장비대여", gaps: "챗봇 개선", info: "정보", as: "캐릭터 바꿔서 열기", trend: "시세 동향", enhance: "강화 비교",
};
const RENT_VIEW: Record<string, string> = { apps: "신청함", staff: "운영", log: "기록" };

const IMO_TAB: Record<string, string> = { all: "", notice: "공지사항", maint: "점검", event: "이벤트" };

/** 화면 주소를 이름으로: 글은 제목, 사냥터와 몬스터는 이름. detail 은 서버가 같이 남긴 글 제목 (게시판·아이모 소식 글) */
export function pageName(path: string, wiki: Wiki, detail?: string | null): string {
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
  // 게시판 안에서 무엇을 봤는지 (제작자 요청 2026-11-02): 칸, 읽은 글 제목, 글쓰기
  if (page === "board") {
    const sub = raw.split("/")[2];
    if (arg === "write") return "게시판 글쓰기";
    if (/^\d+$/.test(arg)) return sub === "edit" ? `게시판 글 고치기 #${arg}` : `게시판 글: ${detail ?? `#${arg}`}`;
    const qs = new URLSearchParams(query);
    const cat = qs.get("cat");
    if (cat === "imo") {
      const t = IMO_TAB[qs.get("t") ?? "all"];
      return `게시판: 아이모 소식${t ? ` · ${t}` : ""}`;
    }
    return cat && cat in CAT_NAME ? `게시판: ${CAT_NAME[cat as Cat]}` : "게시판";
  }
  if (page === "official") return `아이모 소식 글: ${detail ?? `#${arg}`}`;
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
  if (page === "rent") {
    const v = RENT_VIEW[new URLSearchParams(query).get("v") ?? ""];
    return v ? `장비대여: ${v}` : "장비대여";
  }
  if (page === "chat") return arg === "list" ? "챗봇: 대화 목록" : /^\d+$/.test(arg) ? "챗봇: 지난 대화" : "챗봇";
  if (page === "me") return new URLSearchParams(query).get("open") === "kakao" ? "내 정보: 카톡 오픈프로필" : "내 정보";
  // 모르는 화면도 주소 대신 홈 칸 이름이나 '앱 화면' (제작자 요청 2026-11-02: 코드 말고 누구나 알게)
  return PAGE_NAME[page] ?? ITEMS.find((i) => i.to === `#/${page}`)?.title ?? "앱 화면";
}

type Rec = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const won = (n: number) => n.toLocaleString("ko-KR");
/** 짧은 인용 (긴 글은 앞부분만) */
const quote = (v: unknown, max = 40) => {
  const t = str(v);
  return t ? `“${t.length > max ? t.slice(0, max) + "…" : t}”` : null;
};
const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
/** 홈 칸 이름 (배치 바꾸기 기록) */
const tileName = (k: string) => ITEMS.find((i) => i.key === k)?.short ?? ITEMS.find((i) => i.key === k)?.title ?? k;
const TODO_NAME: Record<string, string> = {
  "d:guild-attend": "길드 출석", "d:kui-doll": "잠깬쿠이인형", "w:guild-mission": "길드 임무", "w:guild-dungeon": "길드던전", "w:dungeons": "인던", "w:hunting": "헌팅 그라운드",
};
const ALERT_NAME: Record<string, string> = {
  market_want: "중개인 살래요", market_bid: "경매 입찰", market_outbid: "더 높은 입찰", market_auction: "경매 전환", market_new: "새 물건", gold_want: "골드 거래",
  request: "의뢰", request_new: "새 의뢰", talk: "토론방", account: "계정", shop: "상점", board: "게시판 댓글", board_notice: "새 공지·이벤트", imo_news: "아이모 소식",
  chat_fixed: "챗봇 개선됨", chat_gap: "챗봇 모르는 질문", chat_done: "챗봇 답변 완료", rent: "장비대여", todo: "To do 함께", gdungeon: "길드 던전",
};
const RENT_ACTION: Record<string, string> = { accept: "대여 신청 수락", reject: "대여 신청 거절", cancel: "대여 신청 취소", hand: "대여 완료 (건네줌)" };

/**
 * 한 일을 누구나 읽는 말로 (제작자 요청 2026-11-02 '이런 코드 말고 비개발자가 봐도 얘가 들어가서 뭐 했는지 알게'):
 * 경로와 보낸 자료 대신 '길드 던전 시간표 저장 · 8.5시간', '홈 배치 바꿈 · 아래 탭 …' 처럼. at 은 그 기록의 때 (길드 던전 후보 시각을 쓰려고)
 */
const ACTIONS: [RegExp, (d: Rec, m: RegExpMatchArray, at: number) => string][] = [
  // 계정·내 정보
  [/^POST \/api\/login$/, (d) => (d.failed ? `로그인 실패 (${d.failed === 401 ? "비밀번호 틀림" : String(d.failed)})` : "로그인")],
  [/^POST \/api\/logout$/, () => "로그아웃"],
  [/^POST \/api\/password$/, () => "비밀번호 바꿈"],
  [/^PUT \/api\/profile$/, (d) => join("내 정보 저장", jobLevel(d))],
  [/^(PUT|POST) \/api\/avatar$/, () => "캐릭터 사진 올림"],
  [/^DELETE \/api\/avatar$/, () => "캐릭터 사진 지움"],
  [/^POST \/api\/avatar\/cutout/, () => "캐릭터 사진 AI 보정"],
  [/^PUT \/api\/kakao$/, (d) => (str(d.user) ? `카톡 링크 저장 · ${d.user}` : str(d.link) ? "내 카톡 링크 저장" : "내 카톡 링크 지움")],
  [/^PUT \/api\/layout$/, (d) => join("홈 배치 바꿈", names(d.dock).length ? `아래 탭 ${names(d.dock).map(tileName).join(", ")}` : null)],
  [/^POST \/api\/characters$/, (d) => join("캐릭터 추가 요청", str(d.id))],
  [/^POST \/api\/characters\/switch$/, (d) => join("캐릭터 바꿈", str(d.to) && `→ ${d.to}`)],
  [/^POST \/api\/signup$/, (d) => join("아이디 생성 요청", str(d.id))],
  [/^POST \/api\/signup\/([^/]+)$/, (d, m) => `아이디 생성 요청 ${d.action === "approve" ? "승낙" : d.action === "reject" ? "거절" : "처리"} · ${dec(m[1])}`],
  [/^POST \/api\/delete-requests$/, () => "계정 삭제 요청"],
  [/^DELETE \/api\/delete-requests$/, () => "계정 삭제 요청 취소"],
  [/^POST \/api\/delete-requests\/([^/]+)$/, (d, m) => `계정 삭제 요청 ${d.action === "approve" ? "승낙" : d.action === "reject" ? "거절" : "처리"} · ${dec(m[1])}`],
  [/^PUT \/api\/alerts\/prefs$/, (d) => `알림 설정 · ${ALERT_NAME[String(d.kind)] ?? "알림"} ${d.push !== undefined ? `폰 알림 ${d.push ? "켬" : "끔"}` : d.on ? "켬" : "끔"}`],
  [/^PUT \/api\/alerts\/device$/, () => "폰 알림 상태 확인"],
  [/^POST \/api\/alerts$/, () => "알림 모두 읽음"],
  [/^POST \/api\/push$/, () => "폰 알림 켬"],
  [/^DELETE \/api\/push$/, () => "폰 알림 끔"],
  [/^POST \/api\/dev\/switch$/, (d) => join("테스트 계정 전환", str(d.to) ?? str(d.id))],
  [/^PUT \/api\/favorites$/, (d) => `즐겨찾기 ${d.on === false ? "뺌" : "추가"}${str(d.name) ? ` · ${d.name}` : ""}`],
  // 챗봇
  [/^POST \/api\/chat$/, (d) => join("챗봇에 질문", quote(d.question, 60), num(d.photos) ? `사진 ${d.photos}장` : null)],
  [/^PATCH \/api\/chat\/threads\/\d+$/, (d) => (str(d.title) ? `챗봇 대화 이름 변경 · ${quote(d.title)}` : d.pinned !== undefined ? `챗봇 대화 ${d.pinned ? "고정" : "고정 풀기"}` : "챗봇 대화 고침")],
  [/^DELETE \/api\/chat\/threads\/\d+$/, () => "챗봇 대화 지움"],
  [/^POST \/api\/chat\/threads\/\d+\/msgs$/, () => "챗봇 답 받음"],
  [/^POST \/api\/chat\/gaps$/, () => "챗봇 답에 '별로'"],
  [/^\w+ \/api\/chat\/gaps\/\d+$/, () => "챗봇 개선 완료"],
  // 길드원 관리
  [/^POST \/api\/users$/, (d) => join("계정 만듦", str(d.id))],
  [/^DELETE \/api\/users\/([^/]+)$/, (_d, m) => `계정 지움 · ${dec(m[1])}`],
  [/^PATCH \/api\/users\/([^/]+)$/, (d, m) => `역할 바꿈 · ${dec(m[1])}${str(d.role) ? ` → ${ROLE[String(d.role)] ?? d.role}` : ""}`],
  [/^POST \/api\/users\/([^/]+)\/reset$/, (_d, m) => `비밀번호 초기화 · ${dec(m[1])}`],
  [/^POST \/api\/users\/([^/]+)\/rename$/, (d, m) => `닉네임 바꿈 · ${dec(m[1])}${str(d.newId) ? ` → ${d.newId}` : ""}${d.fresh ? " (다른 캐릭터)" : ""}`],
  [/^PUT \/api\/users\/([^/]+)\/profile$/, (d, m) => join(`정보 수정 · ${dec(m[1])}`, jobLevel(d))],
  [/^DELETE \/api\/users\/([^/]+)\/avatar$/, (_d, m) => `캐릭터 사진 내림 · ${dec(m[1])}`],
  [/^PUT \/api\/users\/([^/]+)\/highspec$/, (d, m) => `고스펙 ${d.on ? "표시" : "해제"} · ${dec(m[1])}`],
  [/^\w+ \/api\/users\/([^/]+)\/levellog/, (_d, m) => `성장 기록 고침 · ${dec(m[1])}`],
  [/^POST \/api\/users\/([^/]+)\/link$/, (d, m) => `계정 통합 · ${dec(m[1])}${str(d.with) ? ` + ${d.with}` : ""}${str(d.main) ? ` (본캐 ${d.main})` : ""}`],
  [/^DELETE \/api\/users\/([^/]+)\/link$/, (_d, m) => `통합 해제 · ${dec(m[1])}`],
  [/^\w+ \/api\/users\/([^/]+)\/main$/, (_d, m) => `본캐 지정 · ${dec(m[1])}`],
  // 중개인·골드
  [/^POST \/api\/market$/, (d) => join(d.side === "buy" ? "중개인 삽니다 글 올림" : "중개인 물건 올림", itemOf(d), price(d))],
  [/^PUT \/api\/market\/\d+\/want$/, (d) => join("중개인 살래요·팔래요", num(d.offer) ? `흥정 ${won(d.offer as number)} 골드` : null, quote(d.note))],
  [/^DELETE \/api\/market\/\d+\/want$/, () => "중개인 살래요·팔래요 취소"],
  [/^PATCH \/api\/market\/\d+$/, (d) => join("중개인 글 고침", str(d.status) ? STATUS[String(d.status)] ?? null : null, price(d))],
  [/^DELETE \/api\/market\/\d+$/, () => "중개인 글 내림"],
  [/^POST \/api\/market\/\d+\/bids$/, (d) => join("중개인 경매 입찰", num(d.amount) ? `${won(d.amount as number)} 골드` : null)],
  [/^POST \/api\/market\/\d+\/auction$/, () => "중개인 경매로 전환"],
  [/^POST \/api\/market\/\d+\/talk$/, (d) => join("토론방 글", quote(d.text))],
  [/^DELETE \/api\/market\/\d+\/talk\/\d+$/, () => "토론방 글 지움"],
  [/^POST \/api\/gold$/, (d) => join(`골드 ${d.side === "buy" ? "삽니다" : "팝니다"} 글 올림`, num(d.gold) ? `${d.gold}만 골드` : null, num(d.rate) ? `시세 ${d.rate}:1` : null)],
  [/^PATCH \/api\/gold\/\d+$/, (d) => join("골드 글 고침", str(d.status) ? STATUS[String(d.status)] ?? null : null, num(d.rate) ? `시세 ${d.rate}:1` : null)],
  [/^DELETE \/api\/gold\/\d+$/, () => "골드 글 내림"],
  [/^PUT \/api\/gold\/\d+\/want$/, (d) => join("골드 거래할래요", quote(d.note))],
  [/^DELETE \/api\/gold\/\d+\/want$/, () => "골드 거래할래요 취소"],
  // 의뢰소
  [/^POST \/api\/requests$/, (d) => join("의뢰 올림", quote(d.title), num(d.rewardGold) ? `보상 ${won(d.rewardGold as number)} 골드` : quote(d.rewardText))],
  [/^PATCH \/api\/requests\/\d+$/, (d) => join(`의뢰 ${REQUEST_ACTION[String(d.action)] ?? "고침"}`, quote(d.note))],
  [/^DELETE \/api\/requests\/\d+$/, () => "의뢰 내림"],
  // 게시판
  [/^POST \/api\/board$/, (d) => join("게시판 글 씀", quote(d.title))],
  [/^PATCH \/api\/board\/\d+$/, (d) => join("게시판 글 고침", quote(d.title))],
  [/^DELETE \/api\/board\/\d+$/, () => "게시판 글 지움"],
  [/^POST \/api\/board\/\d+\/files$/, () => "게시판 사진·파일 올림"],
  [/^POST \/api\/board\/\d+\/comments$/, (d) => join(d.parent ? "게시판 답글" : "게시판 댓글", quote(d.text))],
  [/^PUT \/api\/board\/\d+\/like$/, () => "게시판 좋아요"],
  [/^DELETE \/api\/board\/\d+\/like$/, () => "게시판 좋아요 취소"],
  [/^DELETE \/api\/board\/comments\/\d+$/, () => "게시판 댓글 지움"],
  [/^DELETE \/api\/board\/files\/\d+$/, () => "게시판 파일 지움"],
  [/^POST \/api\/board\/polish$/, () => "공지 AI로 다듬기"],
  [/^POST \/api\/ai\/read$/, (d) => `스샷 읽기 (${d.kind === "rental" ? "장비대여 물건" : "중개인 물건"})`],
  // 플래티넘 상점
  [/^POST \/api\/shop\/orders$/, (d) => join("플래티넘 구매 신청", str(d.itemId))],
  [/^PATCH \/api\/shop\/orders\/\d+$/, (d) => `플래티넘 신청 ${{ done: "거래 완료", cancel: "취소", void: "정산 삭제", restore: "복구", gold: "골드 수정" }[String(d.action)] ?? "처리"}`],
  [/^PUT \/api\/shop$/, () => "플래티넘 상점 설정"],
  [/^PUT \/api\/shop\/items\/(.+)$/, (_d, m) => `플래티넘 물건 설정 · ${dec(m[1])}`],
  // 장비대여
  [/^POST \/api\/rent\/apply$/, (d) => join("장비대여 신청", names(d.items).length || Array.isArray(d.items) ? `무기 ${(d.items as unknown[]).length}개` : null, quote(d.note))],
  [/^POST \/api\/rent\/requests\/\d+$/, (d) => join(RENT_ACTION[String(d.action)] ?? "대여 신청 처리", deposit(d))],
  [/^POST \/api\/rent\/apps\/\d+\/talk$/, (d) => join("장비대여 대화", quote(d.text))],
  [/^POST \/api\/rent$/, (d) => join("장비대여 물건 추가", rentItem(d), str(d.donor) ? `기부 ${d.donor}` : null)],
  [/^PUT \/api\/rent\/\d+$/, (d) => join("장비대여 물건 정보 수정", rentItem(d))],
  [/^DELETE \/api\/rent\/\d+$/, () => "장비대여 물건 내림"],
  [/^POST \/api\/rent\/\d+\/lend$/, (d) => join("장비대여 대여 등록", str(d.renter), deposit(d))],
  [/^POST \/api\/rent\/\d+\/return$/, () => "장비 반납 받음"],
  [/^POST \/api\/rent\/\d+\/return-request$/, (d) => (d.cancel ? "장비 반납 신청 취소" : join("장비 반납 신청", quote(d.when)))],
  [/^POST \/api\/rent\/mileage$/, (d) => join(`마일리지 ${num(d.delta) !== null && (d.delta as number) < 0 ? "차감" : "적립"}`, str(d.who), num(d.delta) !== null ? `💎${Math.abs(d.delta as number)}` : null, quote(d.reason ?? d.note))],
  [/^DELETE \/api\/rent\/mileage/, () => "마일리지 장부 줄 지움"],
  [/^DELETE \/api\/rent\/log/, () => "대여 기록 지움"],
  // To do
  [/^PUT \/api\/todo$/, (d) => join(d.done === false ? "To do 체크 풀기" : "To do 체크", todoName(d.key))],
  [/^POST \/api\/todo\/custom$/, (d) => join("To do 할 일 추가", quote(d.text))],
  [/^DELETE \/api\/todo\/custom\/\d+$/, () => "To do 할 일 삭제"],
  [/^PUT \/api\/todo\/edit$/, (d) => join(d.reset ? "To do 원래대로" : d.hidden === true ? "To do 숨김" : d.hidden === false ? "To do 다시 보기" : "To do 이름 수정", todoName(d.key), quote(d.text))],
  [/^POST \/api\/todo\/share$/, (d) => join("To do 함께 하기", quote(d.text), names(d.members).length ? `함께 ${names(d.members).join(", ")}` : null, str(d.at))],
  [/^PUT \/api\/todo\/share\/\d+$/, (d) => join("To do 함께 고침", str(d.at), names(d.members).length ? `함께 ${names(d.members).join(", ")}` : null)],
  [/^DELETE \/api\/todo\/share\/\d+$/, () => "To do 함께 끝냄"],
  // 길드 던전
  [/^POST \/api\/gd$/, (d) => join("길드 던전 파티 만듦", names(d.members).length ? `함께 ${names(d.members).join(", ")}` : null)],
  [/^PUT \/api\/gd\/avail$/, (d) => join("길드 던전 시간표 저장", hours(d.slots))],
  [/^POST \/api\/gd\/confirm$/, () => "길드 던전 시간표 확정"],
  [/^POST \/api\/gd\/answer$/, (d, _m, at) =>
    d.reset ? "길드 던전 처음부터 다시 정하기" : join(d.answer === "yes" ? "길드 던전 후보 확정" : d.answer === "no" ? "길드 던전 후보 불참" : "길드 던전 대답", gdSlot(d.slot, at))],
  [/^DELETE \/api\/gd\/answer$/, () => "길드 던전 불참 되돌리기"],
  [/^PUT \/api\/gd\/party\/\d+$/, (d) =>
    d.leave ? "길드 던전 파티 나감"
      : str(d.leader) ? `길드 던전 파티장 지정 · ${d.leader}`
        : names(d.add).length ? `길드 던전 파티원 넣음 · ${names(d.add).join(", ")}`
          : names(d.remove).length ? `길드 던전 파티원 뺌 · ${names(d.remove).join(", ")}` : "길드 던전 파티 고침"],
  [/^DELETE \/api\/gd\/party\/\d+$/, () => "길드 던전 파티 지움"],
];

const STATUS: Record<string, string> = { sold: "거래 완료", selling: "다시 판매", done: "끝냄", open: "다시 엶" };
const JOB: Record<string, string> = { warrior: "전사", ranger: "레인저", mage: "마법사", monk: "무도가" };
const ROLE: Record<string, string> = { master: "길드마스터", officer: "오피서", member: "길드원" };
const REQUEST_ACTION: Record<string, string> = { accept: "수락", giveup: "포기", release: "수락 취소", done: "완료", reopen: "다시 모집" };

const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
/** 이름과 내용을 ' · ' 로 (빈 것은 뺀다) */
function join(name: string, ...parts: (string | null | undefined | false)[]): string {
  const p = parts.filter((x): x is string => typeof x === "string" && !!x);
  return p.length ? `${name} · ${p.join(" · ")}` : name;
}
function jobLevel(d: Rec): string | null {
  const bits = [
    d.guild === "main" ? "1군" : d.guild === "second" ? "2군" : null,
    str(d.job) ? JOB[String(d.job)] ?? null : null,
    num(d.level) !== null ? `Lv.${d.level}` : null,
    num(d.exp) !== null ? `경험치 ${((d.exp as number) / 1000).toFixed(3)}%` : null,
    d.change === "fix" ? "오타 수정" : d.change === "grow" ? "실제 성장" : null,
  ].filter(Boolean);
  return bits.length ? bits.join(" ") : null;
}
const itemOf = (d: Rec) => (str(d.item) ? `${num(d.enhance) ? `+${d.enhance}` : ""}${d.item}${num(d.qty) && (d.qty as number) > 1 ? ` ${d.qty}개` : ""}` : null);
const price = (d: Rec) => (num(d.price) !== null ? `${won(d.price as number)} 골드${d.mode === "auction" ? ` 경매 ${d.hours ?? ""}시간` : ""}` : null);
const rentItem = (d: Rec) => (str(d.weapon) ? `${d.weapon}${num(d.enhance) ? ` +${d.enhance}` : ""}${num(d.price) !== null ? ` 💎${d.price}` : ""}` : null);
function deposit(d: Rec): string | null {
  const dia = num(d.useDia) ?? 0;
  const gold = num(d.gold) ?? 0;
  if (!dia && !gold) return null;
  return `보증금 ${[dia ? `💎${dia}` : "", gold ? `${won(Math.round(gold / 10000))}만 골드` : ""].filter(Boolean).join(" + ")}`;
}
const todoName = (k: unknown) => (typeof k === "string" ? TODO_NAME[k] ?? (k.startsWith("o:") ? "이벤트 할 일" : k.includes(":c:") ? "내 할 일" : null) : null);
/** 길드 던전 시간표: 칠한 칸 수로 'N시간' (30분 칸) */
const hours = (v: unknown) => (typeof v === "string" && /^[01]+$/.test(v) ? `${[...v].filter((c) => c === "1").length / 2}시간` : null);
/** 길드 던전 후보 칸 번호를 그 주의 때로 */
const gdSlot = (slot: unknown, at: number) => (typeof slot === "number" && slot >= 0 ? slotText(weekStart(at), slot) : null);

/** 메서드를 말로 (모르는 한 일): 'OO에서 저장' */
const VERB: Record<string, string> = { POST: "보냄", PUT: "저장", PATCH: "고침", DELETE: "지움" };

/** 한 일을 읽는 글로: '중개인 경매 입찰 · 1,600 골드', '길드 던전 시간표 저장 · 8.5시간' */
export function actionText(what: string, detail: string | null, at = Date.now()): string {
  let d: Rec = {};
  try {
    d = detail ? (JSON.parse(detail) as Rec) : {};
  } catch {
    // 모양이 다르면 이름만
  }
  const subject = str(d.subject);
  for (const [re, fn] of ACTIONS) {
    const m = what.match(re);
    if (m) return join(fn(d, m, at), subject);
  }
  // 아직 이름을 안 붙인 한 일: 경로 대신 메뉴 이름과 동작으로 (코드는 보이지 않게)
  const method = what.split(" ")[0];
  const section = ACT_SECTION.find(([re]) => re.test(what))?.[1];
  return join(`${section ?? "앱"}에서 ${VERB[method] ?? "한 일"}`, subject);
}

/**
 * 기록을 메뉴로 묶는 이름 (사용 기록 화면에서 같은 사람이 같은 메뉴에서 잇달아 한 것을 한 줄로, 제작자 요청 2026-11-02).
 * 화면은 주소의 첫 칸, 한 일은 API 경로로 정한다. 접속은 묶지 않는다
 */
const VIEW_SECTION: Record<string, string> = {
  board: "게시판", official: "게시판", market: "중개인", rent: "장비대여", requests: "의뢰소", shop: "플래티넘 상점", chat: "챗봇",
  ranking: "길드 랭킹", admin: "길드원 관리", me: "내 정보", password: "내 정보", alerts: "알림", todo: "To do", log: "사용 기록",
  info: "정보", menu: "정보", post: "정보", place: "정보", places: "정보", monster: "정보", item: "정보", equip: "정보", odds: "정보", search: "검색",
};
const ACT_SECTION: [RegExp, string][] = [
  [/^\w+ \/api\/board/, "게시판"],
  [/^\w+ \/api\/(market|gold)/, "중개인"],
  [/^\w+ \/api\/rent/, "장비대여"],
  [/^\w+ \/api\/requests/, "의뢰소"],
  [/^\w+ \/api\/shop/, "플래티넘 상점"],
  [/^\w+ \/api\/chat/, "챗봇"],
  [/^\w+ \/api\/(users|signup)/, "길드원 관리"],
  [/^POST \/api\/delete-requests\/.+/, "길드원 관리"],
  [/^\w+ \/api\/(profile|avatar|password|kakao|characters)/, "내 정보"],
  [/^\w+ \/api\/todo/, "To do"],
  [/^\w+ \/api\/favorites/, "정보"],
];
export function sectionOf(r: ActivityRow): string | null {
  if (r.kind === "view") {
    const page = r.what.replace(/^#\/?/, "").split(/[/?]/)[0];
    return VIEW_SECTION[page] ?? null;
  }
  if (r.kind === "act") return ACT_SECTION.find(([re]) => re.test(r.what))?.[1] ?? null;
  return null;
}
