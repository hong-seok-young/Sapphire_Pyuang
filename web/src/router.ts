import { useEffect, useState } from "react";

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
 * 앱 안에서 몇 번째 화면인지 (history.state.depth, 처음 연 화면이 0). 위 줄 ◀ 는 앱 안의 앞 화면이 있을 때만 뒤로 가고,
 * 없으면 홈으로 간다 (제작자 요청 2026-11-01: 내 정보에서 ◀ 가 엉뚱한 화면으로 갔다. 카톡 링크로 열었으면 앱 밖으로 나갔다)
 */
let depth = typeof history.state?.depth === "number" ? (history.state.depth as number) : 0;
if (typeof history.state?.depth !== "number") history.replaceState({ ...(history.state ?? {}), depth }, "");
function markDepth() {
  const s = history.state;
  if (s && typeof s.depth === "number") depth = s.depth;
  else {
    depth += 1;
    history.replaceState({ ...(s ?? {}), depth }, "");
  }
}
window.addEventListener("hashchange", markDepth);
window.addEventListener("popstate", markDepth);

/** 위 줄 ◀: 앱 안의 앞 화면으로, 없으면 홈 */
export function goBack() {
  if (depth > 0) history.back();
  else go("#/", true);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function go(to: string, replace = false) {
  if (replace) history.replaceState(history.state, "", to);
  else location.hash = to.replace(/^#/, "");
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}
