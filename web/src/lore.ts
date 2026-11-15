// 아이템 지식 (제작자 2026-11-15 '그 템에 대한 모든 지식이 다 나오게'): scripts/build_lore.py 가 만든 data/lore/NN.json 조각.
// 아이템 화면이 그 아이템 조각 하나만 받는다 (64 조각, 띄어쓰기 뺀 이름의 해시).
import { getJson } from "./data";

/** 카페 글 [글 번호, 제목, 줄들] */
export type LorePost = [string, string, string[]];
/** 해외(글로벌 서버) 팬 위키 번역 문서 */
export interface LoreDoc { t: string; url: string; cat: string; body: string[] }
export interface Lore {
  posts?: LorePost[];
  /** 길드 자료 [출처, 줄들] */
  guild?: [string, string[]][];
  fw?: LoreDoc[];
  /** 이 아이템이 들어 있는 게임 상점 상자 [상자, 개수] */
  box?: [string, number][];
  /** 공식 확률 표 [표 번호, 표 이름, 확률] */
  odds?: [string, string, string][];
  /** 강화 비교에 있는 무기 */
  enh?: 1;
}

const SHARDS = 64;
export const nkey = (s: string) => s.replace(/\s+/g, "");

/** build_lore.py shard 와 같은 셈 */
export function shardOf(name: string): number {
  let h = 0;
  for (const ch of nkey(name)) h = (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h % SHARDS;
}

const shards = new Map<number, Promise<Record<string, Lore>>>();
export function loadLore(name: string): Promise<Lore | null> {
  const n = shardOf(name);
  let p = shards.get(n);
  if (!p) {
    p = getJson<Record<string, Lore>>("lore/" + String(n).padStart(2, "0")).catch((e) => {
      shards.delete(n);
      throw e;
    });
    shards.set(n, p);
  }
  return p.then((d) => d[nkey(name)] ?? null);
}
