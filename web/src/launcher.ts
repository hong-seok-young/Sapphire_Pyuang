// 홈 칸과 아래 탭의 배치 (제작자 요청 2026-11-01: 갤럭시·아이폰 홈 화면처럼 각자 옮기기, 길드 랭킹을 챗봇 자리에 넣는 식으로).
// - 칸(LaunchItem) 하나는 홈 칸들(grid) 아니면 아래 탭(dock)에 있다. 아래 탭은 5칸까지, 홈은 늘 아래 탭 맨 앞 (옮길 수 없다).
// - 검색이 홈 칸으로 올라오면 홈 맨 위에 검색 칸이 생긴다 (아래 탭에 있으면 없다, 같은 기능이라서).
// - 홈에서 칸을 꾹 누르면(0.45초) 편집. 끌어서 홈 칸끼리, 홈 칸과 아래 탭 사이를 옮긴다. 아래 탭이 꽉 찼으면 놓은 자리의 칸과 바꾼다.
// - 배치는 계정마다 서버에 둔다 (/api/layout, D1 layouts. 다른 기기에서도 같게). 이 기기에도 적어 두어 열자마자 그 배치로 그린다.
// - 없는 칸이 새로 생기면 홈 칸 끝에 붙는다. 그 사람에게 안 보이는 칸(운영진, 개발자 칸)은 배치에 있어도 그리지 않는다.
import { useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { api } from "./auth";
import type { Me } from "./auth";
import { RANK } from "./auth";
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
  /** 특정 사람만 들어가는 칸: 테두리에 빛이 돈다 (gold 1군 전용, blue 운영진, purple 개발자) */
  ring?: "gold" | "blue" | "purple";
  soon?: boolean;
  /** soon 일 때 오른쪽 위 표 (없으면 '준비 중') */
  badge?: string;
  /** 아직 못 들어가는 칸 (개발 중): 눌러도 열리지 않는다 */
  locked?: boolean;
  /** 안드로이드 폰 브라우저에서만 보인다 (앱 안, 아이폰에서는 숨김) */
  androidOnly?: boolean;
  /** 오피서 이상에게만 보인다 */
  managers?: boolean;
  /** 앱개발자에게만 보인다 */
  developer?: boolean;
}

export const ITEMS: LaunchItem[] = [
  { key: "home", title: "홈", to: "#/", icon: "🏠", pic: "home", match: [""] },
  // 게시판 (제작자 요청): 공지사항, 길드 이벤트, 자유 게시판. 처음에는 아래 탭 홈 오른쪽 (제작자 요청 2026-11-01)
  { key: "board", title: "게시판", to: "#/board", icon: "📢", match: ["board"] },
  { key: "search", title: "검색", to: "#/search", icon: "🔍", pic: "search", match: ["search"] },
  // 위키 자료. 사냥터와 장비도 이 안에 (제작자 요청 2026-11-01)
  { key: "info", title: "정보", to: "#/info", icon: "📚", pic: "info", match: ["info", "menu", "post", "places", "place", "equip", "odds"] },
  { key: "chat", title: "챗봇", to: "#/chat", icon: "💬", pic: "chat", match: ["chat"] },
  // 1군 전용 플래티넘 할인 상점 (제작자 요청). 아이콘은 게임 첫 화면의 상점 그림. '1군 전용'은 왼쪽 위 띠로
  { key: "shop", title: "플래티넘 할인 상점", short: "상점", to: "#/shop", icon: "🏪", iconPic: "/data/shop/shop_icon.png", ribbon: "1군 전용", ring: "gold", match: ["shop"] },
  { key: "ranking", title: "길드 랭킹", short: "랭킹", to: "#/ranking", icon: "🏆", match: ["ranking"] },
  { key: "market", title: "사파이어 중개인", short: "중개인", to: "#/market", icon: "💰", match: ["market"] },
  { key: "requests", title: "길드원 의뢰소", short: "의뢰소", to: "#/requests", icon: "📋", match: ["requests"] },
  // 길드원끼리 장비 빌려주기, 길드던전과 인던 같이 갈 사람 찾기 (제작자 요청: 칸만 먼저 두고 개발 중으로 막는다)
  { key: "rent", title: "장비대여", to: "", icon: "🤝", soon: true, badge: "개발 중", locked: true, match: [] },
  { key: "match", title: "길던&인던 매칭", short: "매칭", to: "", icon: "⚔️", soon: true, badge: "개발 중", locked: true, match: [] },
  // 시계와 보스 타이머는 안드로이드 앱에만 있다. 앱은 검토 후 오픈 (제작자 요청 2026-10-31: 지금은 웹만)
  { key: "app", title: "안드로이드 앱 받기", short: "앱 받기", to: "#/app", icon: "📲", androidOnly: true, soon: !APP_OPEN, badge: "검토 후 오픈", match: [] },
  { key: "admin", title: "길드원 관리", short: "관리", to: "#/admin", icon: "👥", managers: true, ribbon: "운영진", ring: "blue", match: ["admin"] },
  { key: "log", title: "사용 기록", to: "#/log", icon: "📊", developer: true, ribbon: "개발자", ring: "purple", match: ["log"] },
  // 챗봇이 모르는 질문 (제작자 요청: 보고 고친 뒤 물은 사람에게 알린다)
  { key: "gaps", title: "챗봇 개선", to: "#/gaps", icon: "🧙", developer: true, ribbon: "개발자", ring: "purple", match: ["gaps"] },
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

/** 이 사람에게 보이는 칸인지 */
export const canSee = (item: LaunchItem, me: Me) =>
  (!item.androidOnly || (isAndroid && !inApp)) && (!item.managers || RANK[me.role] >= 1) && (!item.developer || me.role === "developer");

/** 'UPDATE' 를 달지 (updates.ts). '정보'는 안의 칸이 고쳐졌을 때도 */
export const isUpdated = (user: string, item: LaunchItem) =>
  !item.locked && (showUpdate(user, item.to) || (item.key === "info" && INFO_TILES.some((t) => showUpdate(user, t.to))));

export interface Layout {
  dock: string[];
  grid: string[];
}
export const DOCK_MAX = 5;
export const DEFAULT_LAYOUT: Layout = {
  dock: ["home", "board", "search", "info", "chat"],
  grid: ["shop", "ranking", "market", "requests", "rent", "match", "app", "admin", "log", "gaps"],
};

/** 저장된 배치를 맞춘다: 모르는 칸과 겹친 칸은 빼고, 홈은 아래 탭 맨 앞, 아래 탭은 5칸까지, 새로 생긴 칸은 홈 칸 끝에 */
export function normalize(raw: Partial<Layout> | null | undefined): Layout {
  const seen = new Set<string>();
  const keep = (list: unknown) =>
    (Array.isArray(list) ? list : []).filter((k): k is string => typeof k === "string" && BY_KEY.has(k) && k !== "home" && !seen.has(k) && !!seen.add(k));
  const dock = ["home", ...keep(raw?.dock)];
  const grid = keep(raw?.grid);
  while (dock.length > DOCK_MAX) grid.unshift(dock.pop()!);
  for (const k of [...DEFAULT_LAYOUT.dock, ...DEFAULT_LAYOUT.grid]) if (k !== "home" && !seen.has(k)) grid.push(k);
  return { dock, grid };
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

/** 로그인한 사람의 배치: 이 기기에 적어 둔 것으로 먼저 그리고, 서버 것으로 맞춘다 */
export function loadLayout(user: string) {
  if (state.user === user) return;
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

export const setEditing = (editing: boolean) => set({ editing, drag: null, preview: null });
export const resetLayout = () => save(normalize(DEFAULT_LAYOUT));

// ---------- 옮기기 ----------

/**
 * key 를 zone 의 target 칸 앞(뒤)으로 옮긴 배치. target 이 없으면 그 줄 끝.
 * 아래 탭: 홈 앞에는 못 넣고, 꽉 찼으면 놓은 자리(없으면 마지막) 칸과 바꾼다 (빠진 칸은 끌던 칸이 있던 홈 자리로).
 */
export function moveItem(base: Layout, key: string, zone: "dock" | "grid", target: string | null, after: boolean): Layout {
  const dock = base.dock.filter((k) => k !== key);
  const grid = base.grid.filter((k) => k !== key);
  if (zone === "grid") {
    const at = target && grid.includes(target) ? grid.indexOf(target) + (after ? 1 : 0) : grid.length;
    grid.splice(at, 0, key);
    return { dock, grid };
  }
  if (dock.length >= DOCK_MAX) {
    const out = target && target !== "home" && dock.includes(target) ? target : dock[dock.length - 1];
    dock[dock.indexOf(out)] = key;
    const was = base.grid.indexOf(key);
    grid.splice(was >= 0 ? Math.min(was, grid.length) : grid.length, 0, out);
    return { dock, grid };
  }
  const at = target && dock.includes(target) ? dock.indexOf(target) + (after ? 1 : 0) : dock.length;
  dock.splice(Math.max(1, at), 0, key);
  return { dock, grid };
}

/** 손가락(마우스) 아래의 놓을 자리: [data-slot] 칸이면 그 칸 앞/뒤, 아니면 [data-zone] 줄 끝 */
function dropTarget(x: number, y: number): { zone: "dock" | "grid"; target: string | null; after: boolean } | null {
  const el = document.elementFromPoint(x, y);
  const slot = el?.closest<HTMLElement>("[data-slot]");
  if (slot) {
    const r = slot.getBoundingClientRect();
    const zone = slot.dataset.zone as "dock" | "grid";
    // 홈 칸은 3칸 격자라 가로 위치로, 검색 칸(한 줄 전체)은 앞으로
    return { zone, target: slot.dataset.slot!, after: slot.dataset.slot !== "search" && x > r.left + r.width / 2 };
  }
  const zoneEl = el?.closest<HTMLElement>("[data-zone]");
  return zoneEl ? { zone: zoneEl.dataset.zone as "dock" | "grid", target: null, after: true } : null;
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
  const preview = t && t.target !== d.key ? moveItem(d.base, d.key, t.zone, t.target, t.after) : state.preview;
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
