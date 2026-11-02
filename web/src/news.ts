// 새 글·새 물건 숫자 배지 (제작자 요청 2026-11-01: 개발 업데이트 'UPDATE' 와 따로, 사람들이 쓰면서 생긴 새 것은 숫자로).
// 2026-11-02 제작자 요청 '큰 버튼 -> 들어가면 어느 버튼에서 신규인지도 그 안에서도 뜨게 (장비대여에 뱃지 -> 안에서 신청함에 뱃지)':
// 칸 안의 단추마다 따로 센다 (KEYS: 'board.notice', 'market.gold', 'rent.apps' …). 홈 칸과 아래 탭은 그 칸 안의 수를 더한다 (GROUPS).
// 단추마다 마지막으로 본 때를 이 기기에 계정별로 적어 두고 그 뒤로 다른 사람이 올린 수를 서버에 묻는다 (/api/news).
// 아이모 소식(imo.*)은 공식 글이 우리 앱에 처음 들어온 때로 센다 (2026-11-02: 글 번호로 세다가 번호가 먼저 매겨진 예약 글을 놓쳤다).
// 처음 쓰는 기기는 지금부터 센다. 그 단추의 화면을 열면 0 이 된다 (useNewsSeen). 홈으로 올 때, 앱으로 돌아올 때, 2분마다 다시 묻는다.
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./auth";

export const KEYS = [
  "board.notice",
  "board.event",
  "board.free",
  "board.suggest",
  "imo.notice",
  "imo.maint",
  "imo.event",
  "market.items",
  "market.gold",
  "requests",
  "rent.list",
  "rent.apps",
  "rent.staff",
] as const;
export type NewsKey = (typeof KEYS)[number];
/** 홈 칸(launcher.ts 의 key)마다 더하는 단추들 */
const GROUPS: Record<string, string[]> = { board: ["board.", "imo."], market: ["market."], requests: ["requests"], rent: ["rent."] };
const POLL_MS = 120_000;

type Counts = Record<NewsKey, number>;
const zero = (): Counts => Object.fromEntries(KEYS.map((k) => [k, 0])) as Counts;
let counts: Counts = zero();

/** 아이모 점검 하나 (홈 점검 전광판, 제작자 요청 2026-11-01. 서버 server/maint.ts 가 공식 점검 글에서 읽은 것) */
export interface Maint {
  /** 공식 글 번호 (#/official/번호) */
  id: number;
  /** '정기 점검', '임시 점검', '긴급 점검', '점검' */
  label: string;
  start: number;
  /** 모르면 null ('종료 시까지') */
  end: number | null;
  /** 일부 서버만이면 그 서버 */
  servers: string | null;
  extended: boolean;
  /** 인스턴스 던전 입장 제한이 시작되는 때 */
  dungeonFrom: number | null;
}
let maint: Maint[] = [];
let user = "";
let timer: number | undefined;
let listening = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useNews = () => useSyncExternalStore(subscribe, () => counts);
/** 지금 띄울 아이모 점검 (새 글 수와 같이 2분마다 온다) */
export const useMaint = () => useSyncExternalStore(subscribe, () => maint);

const storeKey = () => "sapphire.newsSeen." + user;
function seenAll(): Record<NewsKey, number> {
  let seen: Record<string, number> = {};
  try {
    seen = JSON.parse(localStorage.getItem(storeKey()) ?? "{}") as Record<string, number>;
  } catch {
    // 못 읽으면 지금부터 센다
  }
  const now = Date.now();
  // 때가 아닌 값(예전에 아이모 소식에 적던 공식 글 번호)은 없는 것으로
  const at = (v: number | undefined) => (typeof v === "number" && v > 1e12 ? v : undefined);
  // 예전에 적은 칸 하나짜리 때('board', 'market')는 그 안의 단추들이 이어받는다
  const out = Object.fromEntries(KEYS.map((k) => [k, at(seen[k]) ?? at(seen[k.split(".")[0]]) ?? now])) as Record<NewsKey, number>;
  if (KEYS.some((k) => at(seen[k]) === undefined)) save(out);
  return out;
}
function save(seen: Record<NewsKey, number>) {
  try {
    localStorage.setItem(storeKey(), JSON.stringify(seen));
  } catch {
    // 못 적으면 배지가 남을 뿐이다
  }
}

let inflight: { q: string; p: Promise<void> } | null = null;

/** 서버에 새 것의 수를 묻는다 (실패하면 그대로). 같은 것을 이미 묻는 중이면 그 답을 같이 쓴다 (앱을 열 때 두 번 물었다) */
export function refreshNews(): Promise<void> {
  if (!user) return Promise.resolve();
  const seen = seenAll();
  const q = KEYS.map((k) => `${k}=${seen[k]}`).join("&");
  if (inflight?.q === q) return inflight.p;
  const p = api<{ counts?: Partial<Counts>; maint?: Maint[] }>(`/api/news?${q}`)
    .catch(() => null)
    .then((r) => {
      if (r && user) {
        counts = Object.fromEntries(KEYS.map((k) => [k, r.counts?.[k] ?? 0])) as Counts;
        // 점검은 바뀌었을 때만 새로 (전광판이 흐르다가 처음부터 다시 흐르지 않게)
        if (Array.isArray(r.maint) && JSON.stringify(r.maint) !== JSON.stringify(maint)) maint = r.maint;
        emit();
      }
    })
    .finally(() => {
      if (inflight?.p === p) inflight = null;
    });
  inflight = { q, p };
  return p;
}

/** 로그인한 사람으로 시작 (2분마다, 앱으로 돌아올 때 다시 묻는다) */
export function startNews(id: string) {
  if (user === id) return;
  user = id;
  counts = zero();
  maint = [];
  emit();
  void refreshNews();
  window.clearInterval(timer);
  timer = window.setInterval(() => !document.hidden && void refreshNews(), POLL_MS);
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshNews();
  });
}

/** 단추의 화면을 볼 때: 지금까지 본 것으로 적고 그 배지를 지운다 */
export function markNewsSeen(...keys: NewsKey[]) {
  if (!user || !keys.length) return;
  const seen = seenAll();
  for (const k of keys) seen[k] = Date.now();
  save(seen);
  if (keys.some((k) => counts[k])) {
    counts = { ...counts, ...Object.fromEntries(keys.map((k) => [k, 0])) };
    emit();
  }
}

/**
 * 화면 안에서 지금 보고 있는 단추들을 본 것으로 (열 때와, 보는 동안 새 것이 오면 다시). 아무것도 안 보면 빈 배열
 */
export function useNewsSeen(keys: NewsKey[]) {
  const c = useNews();
  const join = keys.join(",");
  const waiting = keys.some((k) => c[k] > 0);
  useEffect(() => {
    if (join) markNewsSeen(...(join.split(",") as NewsKey[]));
  }, [join, waiting]);
}

/** 단추 하나, 또는 홈 칸(launcher.ts 의 key)이면 그 안의 수를 더한 것 */
export function newsFor(c: Counts, key: string): number {
  if (key in c) return c[key as NewsKey];
  const prefixes = GROUPS[key];
  if (!prefixes) return 0;
  return KEYS.filter((k) => prefixes.some((p) => (p.endsWith(".") ? k.startsWith(p) : k === p))).reduce((n, k) => n + c[k], 0);
}

/** 여러 단추의 합 (게시판 '전체', 아이모 소식 '전체' 같은 단추) */
export const newsSum = (c: Counts, keys: NewsKey[]) => keys.reduce((n, k) => n + c[k], 0);
