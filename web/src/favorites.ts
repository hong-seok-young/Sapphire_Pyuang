// 즐겨찾기 (제작자 요청, 서버 functions/api/favorites.ts): 아이템, 몬스터, 사냥터에 ☆ 를 달아 검색 화면 위에 모아 본다.
// 최근 검색어는 이 기기에만 둔다 (localStorage).
import { useEffect, useState } from "react";
import { api } from "./auth";

export type FavKind = "item" | "monster" | "place";

export interface Favorite {
  kind: FavKind;
  /** 아이템·몬스터는 이름, 사냥터는 id */
  key: string;
  name: string;
  at: number;
}

let cache: Favorite[] | null = null;
let loading: Promise<Favorite[]> | null = null;
const listeners = new Set<(f: Favorite[]) => void>();
const emit = () => listeners.forEach((l) => l(cache ?? []));

function load(): Promise<Favorite[]> {
  if (!loading) {
    loading = api<Favorite[]>("/api/favorites").then(
      (list) => {
        cache = list;
        emit();
        return list;
      },
      (e) => {
        loading = null; // 다음에 다시 해 본다
        throw e;
      },
    );
  }
  return loading;
}

/** 내 즐겨찾기 (처음 한 번 서버에서 받고, 바꾸면 모든 화면이 같이 바뀐다) */
export function useFavorites(): Favorite[] {
  const [list, setList] = useState<Favorite[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setList);
    if (!cache) load().catch(() => {});
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list;
}

export const isFavorite = (list: Favorite[], kind: FavKind, key: string) => list.some((f) => f.kind === kind && f.key === key);

/** 달기 / 빼기. 화면은 먼저 바꾸고, 서버가 거절하면 되돌린다 */
export async function toggleFavorite(kind: FavKind, key: string, name: string): Promise<void> {
  const before = cache ?? [];
  const on = !isFavorite(before, kind, key);
  cache = on ? [{ kind, key, name, at: Date.now() }, ...before] : before.filter((f) => !(f.kind === kind && f.key === key));
  emit();
  try {
    await api("/api/favorites", "PUT", { kind, key, name, on });
  } catch (e) {
    cache = before;
    emit();
    throw e;
  }
}

const RECENT_KEY = "sapphire.recentSearch";
const RECENT_MAX = 12;

/** 최근 검색어 (이 기기에만, 최근 것부터) */
export function recentSearches(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // 저장을 못 하면 기록만 안 남는다
  }
}

export function rememberSearch(q: string) {
  const t = q.trim();
  if (!t) return;
  saveRecent([t, ...recentSearches().filter((x) => x !== t)]);
}

export function forgetSearch(q: string | null) {
  saveRecent(q === null ? [] : recentSearches().filter((x) => x !== q));
}
