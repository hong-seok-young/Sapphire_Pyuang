// 홈 칸과 아래 탭의 배치 (제작자 요청 2026-11-01: 갤럭시·아이폰 홈 화면처럼 각자 옮기기, 길드 랭킹을 챗봇 자리에 넣는 식으로).
// - 칸(LaunchItem) 하나는 홈 칸들(grid) 아니면 아래 탭(dock)에 있다. 아래 탭은 5칸까지, 홈은 늘 아래 탭 맨 앞 (옮길 수 없다).
// - 검색이 홈 칸으로 올라오면 홈 맨 위에 검색 칸이 생긴다 (아래 탭에 있으면 없다, 같은 기능이라서).
// - 홈에서 칸을 꾹 누르면(0.45초) 편집. 끌어서 홈 칸끼리, 홈 칸과 아래 탭 사이를 옮긴다. 아래 탭이 꽉 찼으면 놓은 자리의 칸과 바꾼다.
// - 홈 칸은 3칸 격자의 정해진 자리(slot)에만 놓인다 (제작자 요청 2026-11-03: '위로 정렬 말고 중간에 빈칸 있더라도 지정된 칸에만, 너무 자유롭게는 말고'):
//   grid 는 자리 순서대로 칸 이름이고 빈 자리는 "" 다. 빈 자리에 놓으면 거기 그대로, 다른 칸 위에 놓으면 둘이 자리를 바꾼다 (위로 몰리지 않는다).
//   검색 칸은 자리가 아니라 맨 위 한 줄이라 grid 맨 앞에 "search" 로만 둔다 (gridSlots 는 그것을 뺀 자리 목록).
// - 배치는 계정마다 서버에 둔다 (/api/layout, D1 layouts. 다른 기기에서도 같게). 이 기기에도 적어 두어 열자마자 그 배치로 그린다.
// - 없는 칸이 새로 생기면 홈 칸 끝에 붙는다. 그 사람에게 안 보이는 칸(운영진, 개발자 칸)은 배치에 있어도 그리지 않는다.
import { useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { api } from "./auth";
import type { Me } from "./auth";
import { RANK, TEST_IDS } from "./auth";
import { APP_OPEN, inApp, isAndroid } from "./platform";
import { showUpdate } from "./updates";

export interface LaunchItem {
  key: string;
  title: string;
  /** 아래 탭에 들어갔을 때 이름 (없으면 title) */
  short?: string;
  to: string;
  icon: string;
  /** 이모지 대신 그림 (상점 칸만: 게임 첫 화면의 상점 그림) */
  iconPic?: string;
  /** 아래 탭의 픽셀 그림 (public/icons) */
  pic?: "home" | "search" | "info" | "chat";
  /** 이 칸이 켜지는 화면들 (아래 탭) */
  match: string[];
  /** 칸 왼쪽 위 작은 띠 (예: 1군 전용) */
  ribbon?: string;
  /** 칸 오른쪽 위 작은 글자 줄들 (상자 없이 글자만. 장비대여의 '담당자' / '멍멍', 제작자 요청 2026-11-03) */
  corner?: string[];
  /** 특정 사람만 들어가는 칸: 테두리에 빛이 돈다 (gold 1군 전용, blue 운영진, purple 개발자) */
  ring?: "gold" | "blue" | "purple";
  /** 개발 중·검토 후 오픈: 홈에서는 열린 칸 아래 접힌 '개발 중' 묶음에 들어간다 (제작자 요청 2026-11-02, Home.tsx) */
  soon?: boolean;
  /** soon 일 때 오른쪽 위 표 (없으면 '준비 중') */
  badge?: string;
  /** 아직 못 들어가는 칸 (개발 중): 길드원은 눌러도 열리지 않는다. 운영진과 앱개발자는 들어간다 (제작자 요청 2026-11-02, canPreview) */
  locked?: boolean;
  /** 안드로이드 폰 브라우저에서만 보인다 (앱 안, 아이폰에서는 숨김) */
  androidOnly?: boolean;
  /** 오피서 이상에게만 보인다 */
  managers?: boolean;
  /** 앱개발자에게만 보인다 */
  developer?: boolean;
  /** 길드마스터와 앱개발자만 (사용 기록, 챗봇 개선: 제작자 요청 2026-11-02 '길드마스터도 보이게') */
  masters?: boolean;
}

/** 운영진 때리기를 모두에게 열었는지 (서버 server/smack.ts SMACK_OPEN 과 같이 바꾼다) */
export const SMACK_OPEN = false;
/** 운영진 때리기에 들어가는 사람: 열기 전에는 앱개발자(와 테스트 계정)만 */
export const canSmack = (me: Me) => SMACK_OPEN || me.role === "developer" || TEST_IDS.includes(me.id);

export const ITEMS: LaunchItem[] = [
  { key: "home", title: "홈", to: "#/", icon: "🏠", pic: "home", match: [""] },
  // 게시판 (제작자 요청): 공지사항, 길드 이벤트, 자유 게시판. 처음에는 아래 탭 홈 오른쪽 (제작자 요청 2026-11-01)
  { key: "board", title: "게시판", to: "#/board", icon: "📢", match: ["board", "official"] },
  { key: "search", title: "검색", to: "#/search", icon: "🔍", pic: "search", match: ["search"] },
  // 위키 자료. 사냥터와 장비도 이 안에 (제작자 요청 2026-11-01)
  { key: "info", title: "정보", to: "#/info", icon: "📚", pic: "info", match: ["info", "menu", "post", "places", "place", "equip", "odds"] },
  { key: "chat", title: "챗봇", to: "#/chat", icon: "💬", pic: "chat", match: ["chat"] },
  // 1군 전용 플래티넘 할인 상점 (제작자 요청). 아이콘은 게임 첫 화면의 상점 그림. '1군 전용'은 왼쪽 위 띠로
  { key: "shop", title: "플래티넘 할인 상점", short: "상점", to: "#/shop", icon: "🏪", iconPic: "/data/shop/shop_icon.png", ribbon: "1군 전용", ring: "gold", match: ["shop"] },
  // To do: 이벤트를 안 읽어도 내 직업·레벨에 맞는 오늘·이번 주 할 일 (제작자 요청 2026-11-01, pages/Todo.tsx)
  // To do: 2026-11-02 열었다 (제작자 요청 '투두도 오픈')
  { key: "todo", title: "To do", to: "#/todo", icon: "✅", match: ["todo"] },
  { key: "ranking", title: "길드 랭킹", short: "랭킹", to: "#/ranking", icon: "🏆", match: ["ranking"] },
  { key: "market", title: "사파이어 중개인", short: "중개인", to: "#/market", icon: "💰", match: ["market"] },
  { key: "requests", title: "길드원 의뢰소", short: "의뢰소", to: "#/requests", icon: "📋", match: ["requests"] },
  // 시세 동향 (개발중, 제작자 요청 2026-11-03): 거래 톡방 대화에서 모은 골드·물건·캐릭터 시세. 아이콘은 거래소 동전. 개발 중 묶음 (운영진만)
  { key: "enhance", title: "강화 비교", short: "강화", to: "#/enhance", icon: "⚒️", iconPic: "/icons/enhance.png", match: ["enhance"] },
  // 확률 시뮬레이터 (개발중, 제작자 요청 2026-11-04): 공식 확률 표로 강화·스탯 부여·옵션·상자를 해 본다
  // 확률 시뮬레이터는 앱개발자만 (제작자 2026-11-04 '개발 중으로 나만 보게')
  { key: "sim", title: "확률 시뮬레이터", short: "확률", to: "#/sim", icon: "🎰", soon: true, badge: "개발중", match: ["sim"] },
  // 확률 시뮬레이터 테스트판 (제작자 2026-11-04 '내가 테스트하는 공간을 따로 도플갱어로, 나만 보이는 테스트 버튼'): 같은 화면, 자료만 따로 (?space=test, 표 sim_t_*)
  // 홈에서는 '개발 중' 묶음 안에 확률 시뮬레이터와 똑같은 칸, 오른쪽 위 표만 '테스트' (제작자 2026-11-04 '개발 중으로 넣고 이름이랑 아이콘 다 똑같이, 오른쪽 위에 테스트라고만')
  { key: "simtest", title: "확률 시뮬레이터", short: "확률", to: "#/simtest", icon: "🎰", developer: true, soon: true, badge: "테스트", match: ["simtest"] },
  // 개발 요청 (개발중, 제작자 요청 2026-11-05 '개발 중 버튼 하나 더, 개발자한테 자유롭게 신청, 결재선'): src/pages/DevRequests.tsx
  { key: "devreq", title: "개발 요청", short: "요청", to: "#/devreq", icon: "📮", match: ["devreq"] },
  // 운영진 때리기 (개발 요청 #10, 제작자 2026-11-09 '우선 나한테만 보이게'): 길마·오피서 캐릭터를 두드려 스트레스 풀기 (pages/Smack.tsx).
  // 열 때는 developer·soon·badge 를 빼고 SMACK_OPEN (CLAUDE.md '운영진 때리기')
  { key: "smack", title: "운영진 때리기", short: "때리기", to: "#/smack", icon: "🥊", developer: !SMACK_OPEN, soon: !SMACK_OPEN, badge: "개발중", match: ["smack"] },
  { key: "trend", title: "시세 동향", short: "시세", to: "#/trend", icon: "📈", iconPic: "/data/market/coin.png", soon: true, badge: "개발중", match: ["trend"] },
  // 장비대여 (2026-11-02 제작자 요청으로 열었다), 길드던전과 인던 같이 갈 사람 찾기 (칸만 먼저 두고 개발 중으로 막는다)
  // 오른쪽 위에 담당자 (제작자 요청 2026-11-03 '장비대여 담당자는 멍멍, 버튼 우측 상단에 텍스트로만 관리자 줄바꿈 멍멍'. 담당이 바뀌면 server/rental.ts RENT_STAFF 와 같이 고친다)
  { key: "rent", title: "장비대여", to: "#/rent", icon: "🤝", corner: ["담당자", "멍멍"], match: ["rent"] },
  // 길드 던전 (제작자 요청 2026-11-02: '길던 인던 매칭을 길드 던전으로 바꾸고 1군 전용', 같은 날 오픈). 4인 파티가 이번 주에 갈 때를 정한다 (pages/GuildDungeon.tsx).
  // 칸 이름(key match, 주소 #/match)은 그대로라 저장된 배치가 이어진다
  { key: "match", title: "길드 던전", short: "길드던전", to: "#/match", icon: "⚔️", ribbon: "1군 전용", ring: "gold", match: ["match"] },
  // 시계와 보스 타이머는 안드로이드 앱에만 있다. 앱은 검토 후 오픈 (제작자 요청 2026-10-31: 지금은 웹만)
  { key: "app", title: "안드로이드 앱 받기", short: "앱 받기", to: "#/app", icon: "📲", androidOnly: true, soon: !APP_OPEN, badge: "검토 후 오픈", match: [] },
  { key: "admin", title: "길드원 관리", short: "관리", to: "#/admin", icon: "👥", managers: true, ribbon: "운영진", ring: "blue", match: ["admin"] },
  { key: "log", title: "사용 기록", to: "#/log", icon: "📊", masters: true, ribbon: "길마", ring: "purple", match: ["log"] },
  // 챗봇이 모르는 질문 (제작자 요청: 보고 고친 뒤 물은 사람에게 알린다)
  // 아이콘은 고치는 연장 (제작자 요청 2026-11-02 '챗봇 개선 아이콘은 좀 바꾸자', 예전 🧙)
  { key: "gaps", title: "챗봇 개선", to: "#/gaps", icon: "🛠️", masters: true, ribbon: "길마", ring: "purple", match: ["gaps"] },
];
const BY_KEY = new Map(ITEMS.map((i) => [i.key, i]));
export const itemOf = (key: string) => BY_KEY.get(key);

/** '정보' 안의 위키 자료 칸. 사냥터와 장비도 여기 (제작자 요청 2026-11-01: 아래 탭에서 정보 안으로) */
export const INFO_TILES: LaunchItem[] = [
  { key: "places", title: "사냥터", to: "#/places", icon: "🗺️", match: [] },
  { key: "equip", title: "장비", to: "#/equip", icon: "🛡️", match: [] },
  { key: "guide", title: "육성 공략", to: "#/menu/육성 공략", icon: "📈", match: [] },
  { key: "skills", title: "직업별 스킬", to: "#/menu/직업별 스킬", icon: "✨", match: [] },
  { key: "combine", title: "조합책", to: "#/menu/조합책", icon: "⚒️", match: [] },
  { key: "enhance", title: "강화 · 보석 · 성장", to: "#/menu/강화 · 보석 · 성장", icon: "💎", match: [] },
  { key: "dungeon", title: "인던 · 길드던전", to: "#/menu/인던 · 길드던전", icon: "🏰", match: [] },
  { key: "war", title: "전장 · 헌팅그라운드", to: "#/menu/전장 · 헌팅그라운드", icon: "🚩", match: [] },
  { key: "quest", title: "퀘스트 · 지도", to: "#/menu/퀘스트 · 지도", icon: "📜", match: [] },
  // 컴투스 공식 확률 정보 (제작자 요청 2026-10-31, pages/Odds.tsx)
  { key: "odds", title: "공식 확률", to: "#/odds", icon: "🎲", match: [] },
];

/**
 * 개발 중인 것을 미리 보는 사람: 길드마스터, 오피서, 앱개발자 (제작자 요청 2026-11-02: '개발 중' 묶음 안은 운영진과 개발자만).
 * 테스트 계정도 (앱개발자가 To do '함께' 같은 상대방 쪽을 시험하려고). 서버는 server/rental.ts canEnter, server/todo.ts shareablePeople
 */
/** 개발 중을 미리 보는 길드원 (제작자 2026-11-04 '앞으로 개발 중인 것들은 길드마스터 오피서 달팽이 간다이 이렇게 볼 수 있는 거야'): 묶은 캐릭터 중 하나라도.
 *  닉네임으로 정하므로 닉네임을 바꾸면 고친다. 서버는 server/simcoin.ts PREVIEW_PEOPLE (같은 목록) */
export const PREVIEW_PEOPLE = ["달팽이", "간다이"];
export const canPreview = (me: Me) =>
  RANK[me.role] >= 1 || TEST_IDS.includes(me.id) || [me.id, ...(me.characters ?? []).map((c) => c.id)].some((c) => PREVIEW_PEOPLE.includes(c));
/** 눌러도 안 열리는 칸인지: 개발 중인 칸은 길드원에게만 막는다 */
export const isLocked = (item: LaunchItem, me: Me) => !!item.locked && !canPreview(me);

/** 이 사람에게 보이는 칸인지 */
export const canSee = (item: LaunchItem, me: Me) =>
  (!item.androidOnly || (isAndroid && !inApp)) && (!item.managers || RANK[me.role] >= 1) && (!item.developer || me.role === "developer") && (!item.masters || RANK[me.role] >= 2);

/** 'UPDATE' 를 달지 (updates.ts). '정보'는 안의 칸이 고쳐졌을 때도 */
export const isUpdated = (user: string, item: LaunchItem) =>
  !item.locked && (showUpdate(user, item.to) || (item.key === "info" && INFO_TILES.some((t) => showUpdate(user, t.to))));

export interface Layout {
  dock: string[];
  /** 홈 칸 자리 순서 (3칸씩 한 줄). "" 는 빈 자리. 검색이 홈에 있으면 맨 앞에 "search" (자리를 차지하지 않는다) */
  grid: string[];
}
export const DOCK_MAX = 5;
/** 홈 칸 격자의 가로 칸 수와 자리 수 한도 (20줄) */
export const COLS = 3;
export const MAX_SLOTS = 60;
/** 빈 자리 */
export const EMPTY = "";
/** 홈 칸 자리 목록 (검색 칸은 뺀다) */
export const gridSlots = (l: Layout) => l.grid.filter((k) => k !== "search");
/** 검색 칸이 홈 맨 위에 있는지 */
export const searchUp = (l: Layout) => l.grid.includes("search");
/** from 부터 첫 빈 자리 (없으면 끝) */
function firstEmpty(slots: string[], from = 0): number {
  for (let i = from; i < slots.length; i++) if (slots[i] === EMPTY) return i;
  return slots.length;
}
/**
 * 이 사람의 홈 격자에 보이는 칸인지 (loadLayout 이 정한다). 안 보이는 칸(운영진 칸, 개발 중 칸)은 자리를 차지하지 않고 끝에 붙여 둔다
 * (제작자 2026-11-03: 새로고침하니 '앱 받기'(개발 중)가 있던 자리가 빈 칸으로 떠서 '또 지랄났네'. 안 보이는 칸이 빈 자리를 만들면 안 된다)
 */
let visible: (key: string) => boolean = () => true;
const hidden = (k: string) => k !== EMPTY && !visible(k);
/** 자리 목록과 검색 여부로 배치를 만든다: 안 보이는 칸은 자리에서 빼 끝에 붙이고, 끝의 빈 자리는 뗀다 */
function build(dock: string[], slots: string[], search: boolean): Layout {
  const tail = slots.filter(hidden);
  const s = slots.map((k) => (hidden(k) ? EMPTY : k)).slice(0, MAX_SLOTS);
  while (s.length && s[s.length - 1] === EMPTY) s.pop();
  return { dock, grid: [...(search ? ["search"] : []), ...s, ...tail].slice(0, MAX_SLOTS + 1) };
}
/** 처음 배치 (제작자 요청 2026-11-02: 제작자 폰의 배치 그대로 '이걸 기본 배치로') */
export const DEFAULT_LAYOUT: Layout = {
  dock: ["home", "board", "info", "search", "chat"],
  grid: ["shop", "ranking", "market", "todo", "match", "requests", "rent", "admin", "log", "gaps", "trend", "enhance", "sim", "simtest", "devreq", "app", "smack"],
};

/**
 * 저장된 배치를 맞춘다: 모르는 칸과 겹친 칸은 빈 자리로, 홈은 아래 탭 맨 앞, 아래 탭은 5칸까지, 새로 생긴 칸은 홈 칸 끝에.
 * 홈 칸의 자리(빈 자리 "")는 그대로 둔다 (예전 배치는 빈 자리가 없어 그대로 위부터 채워진다)
 */
export function normalize(raw: Partial<Layout> | null | undefined): Layout {
  const seen = new Set<string>();
  const ok = (k: unknown): k is string => typeof k === "string" && BY_KEY.has(k) && k !== "home" && !seen.has(k) && !!seen.add(k);
  const dock = ["home", ...(Array.isArray(raw?.dock) ? raw.dock : []).filter(ok)];
  const rawGrid = Array.isArray(raw?.grid) ? raw.grid : [];
  const search = rawGrid.includes("search") && ok("search");
  let slots = rawGrid.filter((k) => k !== "search").map((k) => (ok(k) ? k : EMPTY));
  const put = (k: string) => {
    const i = firstEmpty(slots);
    slots[i] = k;
  };
  while (dock.length > DOCK_MAX) put(dock.pop()!);
  for (const k of [...DEFAULT_LAYOUT.dock, ...DEFAULT_LAYOUT.grid]) if (k !== "home" && !seen.has(k)) slots.push(k);
  // 마지막 빈 자리 뒤는 위부터 채운 것 (빈 자리가 하나도 없는 예전 배치·기본 배치는 전부): 안 보이는 칸을 빼고 붙여 그 자리가 빈 칸이 되지 않게 한다.
  // 끝에 붙여 두었던 안 보이던 칸이 새로 열리거나(개발 중이던 칸 오픈) 새 칸이 끝에 붙어도 앞의 안 보이는 칸 자리만큼 띄지 않고 마지막 칸 바로 뒤에 놓인다
  // (2026-11-05 강화 비교 오픈: 앱 받기·시세 동향 자리만큼 두 칸이 비었다)
  const lastEmpty = slots.lastIndexOf(EMPTY);
  const rest = slots.slice(lastEmpty + 1);
  slots = [...slots.slice(0, lastEmpty + 1), ...rest.filter((k) => !hidden(k)), ...rest.filter(hidden)];
  return build(dock, slots, search);
}

// ---------- 상태 (홈과 아래 탭이 같이 본다) ----------

interface Drag {
  key: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
  /** 끌기 시작할 때의 배치 (미리 보기는 늘 여기서 다시 계산해 떨리지 않게) */
  base: Layout;
}
interface State {
  user: string;
  layout: Layout;
  editing: boolean;
  drag: Drag | null;
  /** 끄는 동안 놓으면 될 배치 */
  preview: Layout | null;
}
let state: State = { user: "", layout: DEFAULT_LAYOUT, editing: false, drag: null, preview: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useLauncher = () => useSyncExternalStore(subscribe, () => state);

const cacheKey = (user: string) => "sapphire.layout." + user;

/** 로그인한 사람의 배치: 이 기기에 적어 둔 것으로 먼저 그리고, 서버 것으로 맞춘다. 안 보이는 칸(역할, 개발 중)은 자리에서 빼 둔다 */
export function loadLayout(me: Me) {
  const user = me.id;
  visible = (k) => {
    const t = BY_KEY.get(k);
    return !!t && canSee(t, me) && !t.soon;
  };
  if (state.user === user) {
    // 역할이 바뀌어 보이는 칸이 달라졌으면 자리만 다시 맞춘다
    if (!state.drag) set({ layout: normalize(state.layout) });
    return;
  }
  let cached: Layout | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(cacheKey(user)) ?? "null") as Layout | null;
  } catch {
    // 못 읽으면 기본 배치
  }
  set({ user, layout: normalize(cached ?? DEFAULT_LAYOUT), editing: false, drag: null, preview: null });
  api<{ layout: Layout | null }>("/api/layout")
    .then((r) => {
      if (state.user === user && r.layout && !state.drag) set({ layout: normalize(r.layout) });
    })
    .catch(() => undefined);
}

function save(layout: Layout) {
  set({ layout });
  try {
    localStorage.setItem(cacheKey(state.user), JSON.stringify(layout));
  } catch {
    // 이 기기에 못 적어도 서버에는 간다
  }
  void api("/api/layout", "PUT", layout).catch(() => undefined);
}

export const setEditing = (editing: boolean) => {
  if (!editing) swallowClick = false;
  set({ editing, drag: null, preview: null });
};
export const resetLayout = () => save(normalize(DEFAULT_LAYOUT));

// ---------- 옮기기 ----------

/** 놓을 자리: 홈 칸 격자의 자리 번호(없으면 첫 빈 자리), 또는 아래 탭의 칸 앞/뒤 */
export type Drop = { zone: "grid"; index: number | null } | { zone: "dock"; target: string | null; after: boolean };

/**
 * key 를 놓은 배치 (제작자 요청 2026-11-03: 정해진 자리에만, 빈 자리 그대로):
 * - 홈 자리: 빈 자리면 거기에, 다른 칸이 있으면 둘이 자리를 바꾼다 (끌던 칸이 아래 탭에서 왔으면 밀려난 칸은 다음 빈 자리로).
 *   자리 번호가 없으면(검색 칸이나 격자 바탕에 놓음) 첫 빈 자리. 검색 칸은 자리 없이 맨 위.
 * - 아래 탭: 홈 앞에는 못 넣고, 꽉 찼으면 놓은 자리(없으면 마지막) 칸과 바꾼다 (빠진 칸은 끌던 칸이 있던 홈 자리로, 없으면 첫 빈 자리).
 */
export function placeItem(base: Layout, key: string, drop: Drop): Layout {
  const dock = base.dock.filter((k) => k !== key);
  const before = gridSlots(base);
  const from = before.indexOf(key);
  // 끌던 칸과 안 보이는 칸은 자리에서 뺀다 (안 보이는 칸은 build 가 끝에 붙인다: 그 자리에 놓으면 빈 자리처럼 들어간다)
  const slots = before.map((k) => (k === key || hidden(k) ? EMPTY : k));
  const tail = before.filter((k) => k !== key && hidden(k));
  let search = searchUp(base) && key !== "search";
  const putAt = (k: string, i: number) => {
    while (slots.length <= i) slots.push(EMPTY);
    slots[i] = k;
  };
  if (drop.zone === "grid") {
    // 안 보이는 칸(tail)도 그대로 끝에 붙여 둔다 (빠뜨리면 다음에 열 때 기본 배치 끝으로 다시 붙어 자리가 바뀐다)
    if (key === "search") return build(dock, [...slots, ...tail], true);
    const i = Math.min(drop.index ?? firstEmpty(slots), MAX_SLOTS - 1);
    while (slots.length <= i) slots.push(EMPTY);
    const other = slots[i];
    if (other !== EMPTY) putAt(other, from >= 0 ? from : firstEmpty(slots, i + 1));
    putAt(key, i);
    return build(dock, [...slots, ...tail], search);
  }
  if (dock.length >= DOCK_MAX) {
    const out = drop.target && drop.target !== "home" && dock.includes(drop.target) ? drop.target : dock[dock.length - 1];
    dock[dock.indexOf(out)] = key;
    if (out === "search") search = true;
    else putAt(out, from >= 0 ? from : firstEmpty(slots));
    return build(dock, [...slots, ...tail], search);
  }
  const at = drop.target && dock.includes(drop.target) ? dock.indexOf(drop.target) + (drop.after ? 1 : 0) : dock.length;
  dock.splice(Math.max(1, at), 0, key);
  return build(dock, [...slots, ...tail], search);
}

/** 손가락(마우스) 아래의 놓을 자리: 홈 격자의 [data-index] 자리, 아래 탭의 [data-slot] 칸 앞/뒤, 아니면 그 줄([data-zone]) */
function dropTarget(x: number, y: number): Drop | null {
  const el = document.elementFromPoint(x, y);
  const cell = el?.closest<HTMLElement>("[data-index]");
  if (cell) return { zone: "grid", index: Number(cell.dataset.index) };
  const slot = el?.closest<HTMLElement>("[data-slot]");
  if (slot) {
    if (slot.dataset.zone === "grid") return { zone: "grid", index: null };
    const r = slot.getBoundingClientRect();
    return { zone: "dock", target: slot.dataset.slot!, after: x > r.left + r.width / 2 };
  }
  const zoneEl = el?.closest<HTMLElement>("[data-zone]");
  if (!zoneEl) return null;
  return zoneEl.dataset.zone === "dock" ? { zone: "dock", target: null, after: true } : { zone: "grid", index: null };
}

const LONG_PRESS_MS = 450;
let pressTimer: number | undefined;
let pressStart: { x: number; y: number } | null = null;
/** 꾹 눌러 편집을 켠 뒤 손을 떼면 오는 클릭은 열지 않는다 */
let swallowClick = false;

function onMove(e: PointerEvent) {
  if (pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) cancelPress();
  const d = state.drag;
  if (!d) return;
  const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6;
  const t = moved ? dropTarget(e.clientX, e.clientY) : null;
  const preview = t ? placeItem(d.base, d.key, t) : state.preview;
  set({ drag: { ...d, x: e.clientX, y: e.clientY, moved }, preview });
}

function onUp() {
  cancelPress();
  const d = state.drag;
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
  if (!d) return;
  if (d.moved && state.preview) {
    set({ drag: null });
    save(state.preview);
    set({ preview: null });
  } else set({ drag: null, preview: null });
}

function cancelPress() {
  window.clearTimeout(pressTimer);
  pressTimer = undefined;
  pressStart = null;
}

/**
 * 칸(홈 칸, 아래 탭, 검색 칸)을 누를 때. editable 이 아니면(홈이 아닌 화면의 아래 탭) 아무것도 하지 않는다.
 * 편집 중이 아니면 꾹 누르기를 재고, 편집 중이면 끌기를 시작한다 (홈은 끌 수 없다)
 */
export function pressItem(e: ReactPointerEvent<HTMLElement>, key: string, editable: boolean) {
  swallowClick = false;
  if (!editable || (e.pointerType === "mouse" && e.button !== 0)) return;
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  if (!state.editing) {
    pressStart = { x: e.clientX, y: e.clientY };
    pressTimer = window.setTimeout(() => {
      pressStart = null;
      swallowClick = true;
      navigator.vibrate?.(15);
      setEditing(true);
    }, LONG_PRESS_MS);
    return;
  }
  if (key === "home") return;
  e.preventDefault();
  set({ drag: { key, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, base: state.layout }, preview: null });
}

/** 칸 클릭: 편집 중이거나 방금 꾹 눌러 편집을 켰으면 열지 않는다 */
export function clickItem(e: { preventDefault: () => void }) {
  if (state.editing || swallowClick) e.preventDefault();
  swallowClick = false;
}
