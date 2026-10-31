// 컴투스 공식 확률 정보 (data/odds.json, scripts/build_data.py 의 build_odds, 원본은 비공개 자료 공식/확률/).
// 제작자 요청 2026-10-31: 공식 정보도 위키와 챗봇에. '정보' > '공식 확률' 화면(pages/Odds.tsx)과 챗봇(chat.ts)이 쓴다.
import { getJson } from "./data";

export interface OddsSection {
  /** 섹션 제목 ('베루아(펫)', '바이킹검 - 힘') */
  t: string;
  /** 섹션 설명 (어느 아이템에 붙는 옵션인지 등) */
  d: string;
  /** 열 이름 */
  c: string[];
  r: string[][];
}

export interface OddsTable {
  key: string;
  /** 공식 페이지의 메뉴 길 ('가챠샵', '별똥별의 조각들', '개별 획득 확률') */
  path: string[];
  sections: OddsSection[];
}

export interface Odds {
  /** 받은 때 (ISO) */
  fetched: string;
  /** 공식 페이지 주소 ({key} 자리에 표 번호) */
  page: string;
  /** 반올림 안내 */
  note: string;
  tables: OddsTable[];
}

let oddsPromise: Promise<Odds> | null = null;

export function loadOdds(): Promise<Odds> {
  oddsPromise ??= getJson<Odds>("odds").catch((e) => {
    oddsPromise = null;
    throw e;
  });
  return oddsPromise;
}

/** 메뉴 끝의 '개별 획득 확률' 같은 말은 이름에서 뺀다 */
const GENERIC = /^(개별 )?획득 확률$/;

/** 표 이름: '별똥별의 조각들', '별똥별의 실타래 · 코스튬 옵션 개별 확률' */
export function oddsName(t: OddsTable): string {
  const rest = t.path.slice(1);
  const name = (rest.length > 1 && GENERIC.test(rest[rest.length - 1]) ? rest.slice(0, -1) : rest).join(" · ");
  return name || t.path.join(" · ");
}

export const oddsPage = (odds: Odds, key: string) => odds.page.replace("{key}", key);

/** 찾기용 글 (이름, 섹션 제목, 칸 글자를 띄어쓰기 없이) */
const flat = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const searchCache = new WeakMap<OddsTable, string>();
export function oddsText(t: OddsTable): string {
  let s = searchCache.get(t);
  if (s === undefined) {
    s = flat([t.path.join(" "), ...t.sections.flatMap((x) => [x.t, x.d, ...x.r.map((r) => r.join(" "))])].join(" "));
    searchCache.set(t, s);
  }
  return s;
}

/** 이 표에서 q(띄어쓰기 없이)가 나오는 섹션 번호들 */
export function matchedSections(t: OddsTable, q: string): number[] {
  const k = flat(q);
  return t.sections.map((s, i) => (flat([s.t, s.d, ...s.r.map((r) => r.join(" "))].join(" ")).includes(k) ? i : -1)).filter((i) => i >= 0);
}

export const oddsMatches = (t: OddsTable, q: string) => !!q.trim() && oddsText(t).includes(flat(q));
