import { useCallback, useEffect, useRef, useState } from "react";
import { closeLayersThen } from "./backClose";

/** '#/item/현인의장갑?x=1' -> { parts: ['item', '현인의장갑'], query } (해시 주소라 어디에 올려도 새로고침이 된다) */
export interface Route {
  parts: string[];
  query: URLSearchParams;
}

function read(): Route {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, q = ""] = raw.split("?");
  return {
    parts: path.split("/").filter(Boolean).map((p) => decodeURIComponent(p)),
    query: new URLSearchParams(q),
  };
}

/**
 * 기록 한 칸(화면)마다 history.state 에 몇 번째 화면인지(depth, 처음 연 화면이 0)와 이름표(k)를 붙인다.
 * - 위 줄 ◀ 는 앱 안의 앞 화면이 있을 때만 뒤로 가고, 없으면 홈으로 간다 (제작자 요청 2026-11-01: 내 정보에서 ◀ 가 엉뚱한 화면으로 갔다)
 * - 뒤로 가면 그 화면을 보던 자리(스크롤)와 거른 것, 고른 칸을 그대로 되살린다 (제작자 요청 2026-11-01: 실제로 직전 화면으로).
 *   새 화면으로 가면 맨 위부터
 */
let depth = typeof history.state?.depth === "number" ? (history.state.depth as number) : 0;
let seq = Date.now();
const newKey = () => (++seq).toString(36);
if (typeof history.state?.depth !== "number" || !history.state?.k) {
  history.replaceState({ ...(history.state ?? {}), depth, k: history.state?.k ?? newKey() }, "");
}
let currentKey: string = history.state.k;
/** 방금 옮긴 것이 새 화면(또는 같은 화면 안에서 칸 바꾸기)이면 true, 뒤로·앞으로 간 것이면 false */
let lastWasNew = true;
/** go(..., true) 로 주소만 바꾼 것 (같은 기록 칸) */
let replacing = false;
// 브라우저가 알아서 스크롤을 되돌리지 않게 (화면을 다시 그린 뒤 우리가 되돌린다)
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

function markDepth() {
  const s = history.state;
  if (s?.k && s.k === currentKey) {
    // 같은 칸 (새 칸은 popstate 와 hashchange 가 둘 다 온다). 주소만 바꾼 것이면 새 화면처럼 맨 위로
    if (replacing) {
      replacing = false;
      lastWasNew = true;
    }
    return;
  }
  if (s && typeof s.depth === "number" && s.k) {
    depth = s.depth;
    lastWasNew = false;
  } else {
    depth += 1;
    history.replaceState({ ...(s ?? {}), depth, k: newKey() }, "");
    lastWasNew = true;
  }
  currentKey = history.state.k;
}
window.addEventListener("hashchange", markDepth);
window.addEventListener("popstate", markDepth);

/**
 * 새로고침해도 보던 화면 그대로 (제작자 2026-11-10 '아래로 쓸어서 새로고침하면 있던 화면이 뜨게, 모든 화면에서'):
 * 기록 칸의 이름표(history.state.k)는 새로고침해도 남으므로, 칸마다 고른 칸·거른 것(useEntryState)과 보던 자리(스크롤)를
 * 이 탭의 sessionStorage 에 같이 적어 두고 다시 열 때 읽는다 (앱을 닫았다 열면 처음부터)
 */
const STORE = "sapphire.entry.v1";
type Saved = { v: Record<string, Record<string, unknown>>; y: Record<string, number>; o: string[] };
function loadSaved(): Saved {
  try {
    const s = JSON.parse(sessionStorage.getItem(STORE) ?? "null") as Saved | null;
    if (s && typeof s === "object" && s.v && s.y && Array.isArray(s.o)) return s;
  } catch {
    // 못 읽으면 처음부터
  }
  return { v: {}, y: {}, o: [] };
}
const saved = loadSaved();
let saveTimer = 0;
function writeNow() {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = 0;
  try {
    // 칸이 너무 많아지지 않게 최근 60칸만
    const keep = saved.o.slice(-60);
    const v: Saved["v"] = {};
    const y: Saved["y"] = {};
    for (const k of keep) {
      const ev = entryValues.get(k);
      if (ev) v[k] = ev;
      const sy = scrollOf.get(k);
      if (sy !== undefined) y[k] = sy;
    }
    saved.o = keep;
    sessionStorage.setItem(STORE, JSON.stringify({ v, y, o: keep }));
  } catch {
    // 저장이 안 돼도 화면은 그대로
  }
}
function persist() {
  if (!saveTimer) saveTimer = window.setTimeout(writeNow, 250);
}
function touch(key: string) {
  const i = saved.o.indexOf(key);
  if (i >= 0) saved.o.splice(i, 1);
  saved.o.push(key);
}
// 새로고침·다른 앱으로 갈 때는 바로 적는다
window.addEventListener("pagehide", writeNow);
document.addEventListener("visibilitychange", () => document.hidden && writeNow());

/** 화면(기록 칸)마다 보던 자리 */
const scrollOf = new Map<string, number>(Object.entries(saved.y));
let restoring = false;
window.addEventListener(
  "scroll",
  () => {
    if (restoring) return;
    scrollOf.set(currentKey, window.scrollY);
    touch(currentKey);
    persist();
  },
  { passive: true },
);
/** 새로고침으로 다시 연 칸이면 그 자리로 (화면이 그려진 뒤, useRoute 가 한 번) */
let reopened = scrollOf.has(currentKey) ? currentKey : "";

/** 뒤로 왔을 때 보던 자리로: 자료가 다 그려져 그 자리까지 내려갈 수 있을 때까지 잠깐(3초까지) 기다린다. 손가락을 대면 그만둔다 */
function restoreScroll(y: number, wait = 3000) {
  if (y <= 0) {
    window.scrollTo(0, 0);
    return;
  }
  restoring = true;
  const key = currentKey;
  const until = Date.now() + wait;
  const stop = () => {
    restoring = false;
    window.removeEventListener("touchstart", stop);
    window.removeEventListener("wheel", stop);
  };
  window.addEventListener("touchstart", stop, { passive: true });
  window.addEventListener("wheel", stop, { passive: true });
  const step = () => {
    if (!restoring || key !== currentKey) return stop();
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) < 2 || Date.now() > until) {
      stop();
      scrollOf.set(key, window.scrollY);
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** 위 줄 ◀: 열린 창(backClose.ts)이 있으면 닫고, 앱 안의 앞 화면으로, 없으면 홈 */
export function goBack() {
  closeLayersThen(() => {
    if (depth > 0) history.back();
    else go("#/", true);
  });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    // 새로고침: 자료를 받아 그릴 때까지 조금 더(8초) 기다려 보던 자리로
    if (reopened && reopened === currentKey) restoreScroll(scrollOf.get(currentKey) ?? 0, 8000);
    reopened = "";
    const onChange = () => {
      setRoute(read());
      if (lastWasNew) window.scrollTo(0, 0);
      else restoreScroll(scrollOf.get(currentKey) ?? 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function go(to: string, replace = false) {
  if (replace) {
    replacing = true;
    history.replaceState(history.state, "", to);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else location.hash = to.replace(/^#/, "");
}

/** 화면(기록 칸)마다 기억하는 값 (새로고침해도 남는다, 위 STORE) */
const entryValues = new Map<string, Record<string, unknown>>(Object.entries(saved.v));

/**
 * 이 화면에서만 기억하는 값 (거른 것, 고른 칸, 찾는 말): 다른 화면에 갔다가 뒤로 오면 그대로 되살아난다.
 * 새로 들어오면 initial 부터. useState 처럼 쓴다
 */
export function useEntryState<T>(name: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const key = useRef(currentKey).current;
  const [value, setValue] = useState<T>(() => {
    const saved = entryValues.get(key);
    return saved && name in saved ? (saved[name] as T) : initial;
  });
  const set = useCallback(
    (v: T | ((prev: T) => T)) =>
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        entryValues.set(key, { ...(entryValues.get(key) ?? {}), [name]: next });
        touch(key);
        persist();
        return next;
      }),
    [key, name],
  );
  return [value, set];
}
