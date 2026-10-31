// 새 글·새 물건 숫자 배지 (제작자 요청 2026-11-01: 개발 업데이트 'UPDATE' 와 따로, 사람들이 쓰면서 생긴 새 것은 숫자로).
// 메뉴(게시판, 중개인, 의뢰소)를 마지막으로 연 때를 이 기기에 계정별로 적어 두고, 그 뒤로 다른 사람이 올린 수를 서버에 묻는다
// (/api/news). 처음 쓰는 기기는 지금부터 센다. 그 메뉴를 열면 0 이 된다. 홈으로 올 때, 앱으로 돌아올 때, 2분마다 다시 묻는다.
import { useSyncExternalStore } from "react";
import { api } from "./auth";

export type NewsKey = "board" | "market" | "requests";
const KEYS: NewsKey[] = ["board", "market", "requests"];
/** 어느 화면을 열면 그 메뉴를 본 것으로 치는지 */
const PAGE_OF: Record<string, NewsKey> = { board: "board", market: "market", requests: "requests" };
const POLL_MS = 120_000;

type Counts = Record<NewsKey, number>;
let counts: Counts = { board: 0, market: 0, requests: 0 };
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

const storeKey = () => "sapphire.newsSeen." + user;
function seenAll(): Record<NewsKey, number> {
  let seen: Partial<Record<NewsKey, number>> = {};
  try {
    seen = JSON.parse(localStorage.getItem(storeKey()) ?? "{}") as Partial<Record<NewsKey, number>>;
  } catch {
    // 못 읽으면 지금부터 센다
  }
  const now = Date.now();
  const out = Object.fromEntries(KEYS.map((k) => [k, seen[k] ?? now])) as Record<NewsKey, number>;
  if (KEYS.some((k) => seen[k] === undefined)) save(out);
  return out;
}
function save(seen: Record<NewsKey, number>) {
  try {
    localStorage.setItem(storeKey(), JSON.stringify(seen));
  } catch {
    // 못 적으면 배지가 남을 뿐이다
  }
}

/** 서버에 새 것의 수를 묻는다 (실패하면 그대로) */
export async function refreshNews() {
  if (!user) return;
  const seen = seenAll();
  const q = KEYS.map((k) => `${k}=${seen[k]}`).join("&");
  const r = await api<Counts>(`/api/news?${q}`).catch(() => null);
  if (r && user) {
    counts = { board: r.board ?? 0, market: r.market ?? 0, requests: r.requests ?? 0 };
    emit();
  }
}

/** 로그인한 사람으로 시작 (2분마다, 앱으로 돌아올 때 다시 묻는다) */
export function startNews(id: string) {
  if (user === id) return;
  user = id;
  counts = { board: 0, market: 0, requests: 0 };
  emit();
  void refreshNews();
  window.clearInterval(timer);
  timer = window.setInterval(() => void refreshNews(), POLL_MS);
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshNews();
  });
}

/** 화면을 열 때: 게시판, 중개인, 의뢰소면 지금까지 본 것으로 적고 그 배지를 지운다 */
export function markNewsSeen(page: string) {
  const key = PAGE_OF[page];
  if (!key || !user) return;
  const seen = seenAll();
  seen[key] = Date.now();
  save(seen);
  if (counts[key]) {
    counts = { ...counts, [key]: 0 };
    emit();
  }
}

/** 칸(launcher.ts 의 key)의 숫자 */
export const newsFor = (c: Counts, key: string) => (key in c ? c[key as NewsKey] : 0);
