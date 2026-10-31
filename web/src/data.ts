import { useEffect, useState } from "react";
import type { Monster, Post, Wiki } from "./types";

const BASE = "data/";

/** 위키 자료는 로그인한 길드원에게만 온다 (functions/data/_middleware.ts). 로그인이 풀리면 이 오류가 난다 */
export const NEED_LOGIN = "NeedLogin";

export async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(BASE + name + ".json");
  if (res.status === 401) throw new Error(NEED_LOGIN);
  if (!res.ok) throw new Error(`${name}.json: ${res.status}`);
  return res.json();
}

let wikiPromise: Promise<Wiki> | null = null;

/** 첫 화면에 필요한 자료 (글 본문은 크니까 따로 불러온다). 실패하면 다음에 다시 받는다 */
export function loadWiki(): Promise<Wiki> {
  wikiPromise ??= Promise.all(
    ["menu", "regions", "places", "monsters", "items", "equipment", "meta"].map((n) => getJson<unknown>(n)),
  )
    .then(([menu, regions, places, monsters, items, equipment, meta]) => ({
      menu, regions, places, monsters, items, equipment, meta,
    }) as Wiki)
    .catch((e) => {
      wikiPromise = null;
      throw e;
    });
  return wikiPromise;
}

/** 원글 속 다른 글 링크가 갈 곳. 사냥터 글이면 사냥터 화면, 위키에 있는 글이면 그 글, 없으면 null (글자만 보인다) */
export function postLink(wiki: Wiki, posts: Record<string, Post>): (postId: string) => string | null {
  return (id) => (wiki.places[id] ? "#/place/" + id : id in posts ? "#/post/" + id : null);
}

let postsPromise: Promise<Record<string, Post>> | null = null;
export function loadPosts(): Promise<Record<string, Post>> {
  postsPromise ??= getJson<Record<string, Post>>("posts").catch((e) => {
    postsPromise = null;
    throw e;
  });
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
