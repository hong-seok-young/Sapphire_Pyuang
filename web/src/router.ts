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
  if (replace) history.replaceState(null, "", to);
  else location.hash = to.replace(/^#/, "");
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}
