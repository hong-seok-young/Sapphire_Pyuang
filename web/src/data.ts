import { useEffect, useState } from "react";
import type { Monster, Post, Wiki } from "./types";

const BASE = "data/";

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(BASE + name + ".json");
  if (!res.ok) throw new Error(`${name}.json: ${res.status}`);
  return res.json();
}

let wikiPromise: Promise<Wiki> | null = null;

/** 첫 화면에 필요한 자료 (글 본문은 크니까 따로 불러온다) */
export function loadWiki(): Promise<Wiki> {
  wikiPromise ??= Promise.all(
    ["menu", "regions", "places", "monsters", "items", "equipment", "meta"].map((n) => getJson<unknown>(n)),
  ).then(([menu, regions, places, monsters, items, equipment, meta]) => ({
    menu, regions, places, monsters, items, equipment, meta,
  }) as Wiki);
  return wikiPromise;
}

let postsPromise: Promise<Record<string, Post>> | null = null;
export function loadPosts(): Promise<Record<string, Post>> {
  postsPromise ??= getJson<Record<string, Post>>("posts");
  return postsPromise;
}

export function useAsync<T>(fn: () => Promise<T>): { data?: T; error?: string } {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    let alive = true;
    fn().then((data) => alive && setState({ data }), (e) => alive && setState({ error: String(e) }));
    return () => {
      alive = false;
    };
  }, [fn]);
  return state;
}

/** 같은 이름 몬스터가 여러 사냥터에 나오므로 이름별로 묶는다 */
export function monstersByName(wiki: Wiki): Map<string, Monster[]> {
  const map = new Map<string, Monster[]>();
  for (const m of Object.values(wiki.monsters)) {
    const list = map.get(m.name) ?? [];
    list.push(m);
    map.set(m.name, list);
  }
  return map;
}

export function cafeUrl(postId: string): string {
  return "https://cafe.naver.com/iphoneimo/" + postId;
}
