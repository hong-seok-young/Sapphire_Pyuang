import { useEffect, useState } from "react";
import type { Monster, Post, Wiki } from "./types";

const BASE = "data/";

/** 위키 자료는 로그인한 길드원에게만 온다 (functions/data/_middleware.ts). 로그인이 풀리면 이 오류가 난다 */
export const NEED_LOGIN = "NeedLogin";

export async function getJson<T>(name: string): Promise<T> {
  // 오래 멈춘 요청은 끊는다 (느린 망에서 '불러오는 중'에만 머물지 않고 '다시 시도'가 뜨게)
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(BASE + name + ".json", { signal: ctrl.signal });
    if (res.status === 401) throw new Error(NEED_LOGIN);
    if (!res.ok) throw new Error(`${name}.json: ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new Error("인터넷이 느려요");
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
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

/** 시세 동향 (개발중): build_trend.py 가 거래 톡방 대화에서 만든 자료 (CLAUDE.md '시세 동향') */
/** q1~q3 = 가운데 절반 (그림의 띠) */
export interface TrendStat { n: number; min: number; q1: number; med: number; q3: number; max: number }
export interface GoldDay { date: string; sell: TrendStat | null; buy: TrendStat | null; posts: { sell: number; buy: number } }
/** 올린 사람 한 명의 값 (물건은 만 원, 골드는 N:1) 중간값과 범위, 글 수. 제작자 요청: 누가 싸게 팔고 누가 비싸게 파는지 */
/** tel: 톡방 닉네임 뒤 휴대폰 뒷자리 (있으면 인증된 사용자, 없으면 미인증). 닉네임에는 넣지 않는다 */
export interface TrendPerson { who: string; tel: string; n: number; med: number; min: number; max: number; last: string }
/** 물건의 강화·옵션 묶음 하나 ('+8 지능3'). 옵션마다 값이 달라서 따로 센다 */
export interface TrendVariant {
  label: string; n: number; sellers: number; sell: number; buy: number;
  /** 가격은 만 원 (1장 = 1만 원) */
  med: number; min: number; max: number; recent: number | null; before: number | null;
  first: string; last: string; days: [string, number][]; samples: { date: string; price: number; who: string; tel: string; raw: string }[];
  /** 싼 사람부터 */
  people: TrendPerson[];
}
/** 묶음: 속성부여 템은 주 스탯(지능2 = '지능2', '지능2 체력30' 둘 다), 강화 템은 강화 단계(+8, 노강), 나머지는 '전체'. 안에 옵션 묶음들 */
export interface TrendGroup extends TrendVariant { variants: TrendVariant[] }
export interface TrendItem extends TrendVariant {
  /** 위키 아이템 이름 (wiki 가 true) 또는 톡방 줄임말 그대로 */
  name: string; wiki: boolean; abbr: string[];
  /** 아무도 풀지 못한 줄임말 (위키에도, 알려 준 이름 표에도 없다) */
  unknown?: boolean;
  /** 위키에 없는 물건의 그림 주소 (/data/trend/…png 제작자 도감 스샷에서 자른 것, 스킬북은 /img/… 위키 직업별 스킬의 아이콘) */
  icon?: string;
  /** enchant = 속성부여 부위 (벨트, 망토, 목걸이, 반지), enhance = 강화 부위, none = 그 밖 */
  kind: "enchant" | "enhance" | "none"; groups: TrendGroup[]; variants: TrendVariant[];
  /** 반대쪽(팝니다 목록이면 삽니다)의 중간값과 글 수. 없으면 null */
  other: { med: number; n: number } | null;
}
/** 캐릭터 글 하나. 캘 = 캐릭터만, 템통 = 템까지 */
export interface TrendChar {
  who: string; tel: string; side: "sell" | "buy"; server: string | null; level: number; job: string | null; skills: string;
  /** 도감 요약 한 줄, 게임 '획득 옵션' 순서의 [이름, 값] 표, 도감 랭킹 % (일반, 코스튬, 라이딩) */
  dex: string; dexTable: [string, string][]; collect: Record<string, number>; gems: string;
  pvp: boolean; scope: "" | "캘" | "템통"; price: number; raw: string; n: number; first: string; last: string;
}
export interface TrendBand { band: string; n: number; med: number; min: number; max: number }
export interface Trend {
  source: { rooms: string[]; from: string; to: string; messages: number; built: string; rate: number };
  lastWeek: string; gold: GoldDay[]; goldPeople: { sell: TrendPerson[]; buy: TrendPerson[] };
  /** items = 파는 사람이 부른 값, itemsBuy = 사는 사람이 부른 값 (제작자: 파는 쪽은 비싸게, 사는 쪽은 싸게 부르니 구분) */
  items: TrendItem[]; itemsBuy: TrendItem[];
  chars: { rows: TrendChar[]; bands: TrendBand[] };
}
export const loadTrend = () => getJson<Trend>("trend");

/** 강화 비교 (개발중): scripts/build_enhance.py 가 만든다. bonus: common = 전사·레인저·무도가 공통 가산치, mage = 마법사 무기마다, null = 강화 수치 모름 */
export interface EnhanceWeapon { name: string; job: string; lv: number | null; min: number; max: number; bonus: "common" | "mage" | null; src: "excel" | "wiki" }
export interface Enhance { source: string; common: number[]; mage: Record<string, number[]>; weapons: EnhanceWeapon[] }
export const loadEnhance = () => getJson<Enhance>("enhance");

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
