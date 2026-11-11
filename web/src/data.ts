import { useEffect, useState } from "react";
import { peekMemo, putMemo } from "./memo";
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
/** 시세 동향 물건 칸 (build_trend.py item_cat) */
export type TrendCat = "장비" | "장신구" | "스킬북" | "코스튬" | "기타";
export interface TrendItem extends TrendVariant {
  /** 위키 아이템 이름 (wiki 가 true) 또는 톡방 줄임말 그대로 */
  name: string; wiki: boolean; abbr: string[];
  /** 아무도 풀지 못한 줄임말 (위키에도, 알려 준 이름 표에도 없다) */
  unknown?: boolean;
  cat: TrendCat;
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
/** armor: 방어구 기본 방어도 -> +0~+15 의 방어도 (데미지 계산기) */
export interface Enhance { source: string; common: number[]; mage: Record<string, number[]>; weapons: EnhanceWeapon[]; armor?: Record<string, number[]> }
export const loadEnhance = () => getJson<Enhance>("enhance");

/** 도감 계산기 (개발중): scripts/build_dex.py 가 비공개 자료 도감/일반.json (제작자 도감 영상을 옮긴 것)에서 만든다.
 *  effects = [능력치, 값, % 인지], items 의 n = 필요 개수, plus = 강화 단계, pic = 위키에 그림이 없을 때 영상에서 자른 그림 (/data/dex/…png),
 *  name 이 null 이면 영상에서 칸을 누르지 않아 이름을 모르는 칸 (icon = 생김새), est = 같은 그림으로 이름을 추정한 칸,
 *  sg·sn = 도감 등록 창의 대체 스탬프 (장비스탬프 등급 'S'·'A'·'B' 와 개수, 대체 안 되면 sg '불가') */
export interface DexItem { name: string | null; n: number; plus: number | null; icon?: string | null; pic?: string | null; stamp?: string | null; est?: boolean; sg?: string; sn?: number; info?: string }
/** cat: 코스튬 · 펫 (없으면 일반) */
export interface DexEntry { name: string; effects: [string, number, boolean][]; period?: string | null; items: DexItem[]; cat?: string }
/** 도감 시세 (제작자 요청 2026-11-11, build_dex.py price_data): 장비 이름 key(띄어쓰기·괄호 뺌) -> 종류(무기/갑옷류/기타), 요구 레벨, 강화 단계마다 거래소 최저가.
 *  stamp = 스탬프 1장 플래티넘 값(평소 · 아바돈 이벤트), abaddon = 아바돈 1장이 일반 몇 장, platGold = 플래티넘 1 의 골드. scroll = 마법서 골드 값(등급마다, 자료에 있으면),
 *  sale = 가장 최근 아바돈 장비 스탬프 판매 기간 (공식 패치노트) */
export interface DexGearPrice { k: string | null; lv: number | null; p: Record<string, number> }
export interface DexPrice {
  date: string; src: string; gear: Record<string, DexGearPrice>;
  stamp?: { normal: Record<string, number>; event: Record<string, number>; abaddon: number; platGold: number; date?: string; noteNormal?: string; noteEvent?: string };
  scroll?: Partial<Record<"무기" | "갑옷", Record<string, number>>>;
  sale?: { start: string; end: string; text: string; id?: number };
}
export interface Dex { source: string; built: string; order: string[]; entries: DexEntry[]; price?: DexPrice }
export const loadDex = () => getJson<Dex>("dex");

/** key 를 주면 이번에 연 동안 받은 것을 받는 동안 바로 보인다 (src/memo.ts) */
export function useAsync<T>(fn: () => Promise<T>, key?: string): { data?: T; error?: string } {
  const [state, setState] = useState<{ data?: T; error?: string }>(() => {
    const had = peekMemo<T>(key);
    return had === undefined ? {} : { data: had };
  });
  useEffect(() => {
    let alive = true;
    const had = peekMemo<T>(key);
    if (had !== undefined) setState({ data: had });
    fn().then(
      (data) => {
        putMemo(key, data);
        if (alive) setState({ data });
      },
      (e) => alive && setState({ error: String(e) }),
    );
    return () => {
      alive = false;
    };
    // key 는 fn 과 같이 바뀐다
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
