// 장비대여 목록 읽기 (제작자 요청 2026-11-01): 길드가 카카오톡에 올리던 대여무기 목록 글을 그대로 붙여 넣으면 물건으로 바꾼다.
//   [sapphire 대여무기 목록] 전사.🔪
//   ㅡㅡㅡ‼️기한 제한없음‼️ㅡㅡㅡ        (기한 4주, 기한 2주)
//   Lv.20[카타나]
//   [민초]명9 +7강 💎12                  ([기부자]옵션 +강 💎가격)
//   [오믈렛]명5 +6강 💎4 🆙춘천다크갈비 10.29   (🆙 빌린 사람과 날짜: 지금 대여 중. '🆙26.10.22 혈천도마' 처럼 날짜가 앞이어도)
// 처음 채우는 스크립트(scripts/rental-seed.mjs, 비공개 자료 길드/장비대여/*.txt)가 같이 쓴다.
// Node 가 타입을 지우고 읽으므로 상대 경로 import 는 두지 않는다.

export type RentJob = "warrior" | "ranger" | "mage" | "monk";
/**
 * 대여 기한: 'none' 기한 없음, '3w' 3주 (1~52주). 제작자 요청 2026-11-02: '3주 할 수도 있고 5주 할 수도 있잖아, 뭐 저렇게 고정을 함'
 * (처음엔 기한 없음·4주·2주 셋뿐이었다. 예전 값 '4w', '2w' 도 그대로 맞다)
 */
export type RentTerm = "none" | `${number}w`;
export const MAX_WEEKS = 52;
/** 기한의 주 수 (기한 없음이나 맞지 않는 값이면 null) */
export function termWeeks(t: unknown): number | null {
  const m = typeof t === "string" ? /^(\d{1,2})w$/.exec(t) : null;
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= MAX_WEEKS ? n : null;
}
export const isTerm = (t: unknown): t is RentTerm => t === "none" || termWeeks(t) !== null;
/** 기한의 날 수 (기한 없음이면 null) */
export const termDays = (t: RentTerm): number | null => {
  const w = termWeeks(t);
  return w === null ? null : w * 7;
};
/** '4주', '기한 없음' */
export const termName = (t: RentTerm) => {
  const w = termWeeks(t);
  return w === null ? "기한 없음" : `${w}주`;
};

/** 목록에서 읽은 물건 하나 */
export interface ParsedRental {
  job: RentJob;
  term: RentTerm;
  level: number;
  weapon: string;
  /** 옵션 줄임말 그대로 (띄어쓰기만 뺀다): '명6크3', '지4마11마재1' */
  options: string;
  enhance: number;
  /** 💎 (1개 = 10만 골드) */
  price: number;
  donor: string | null;
  /** 지금 빌려 간 사람과 그 날짜 (ms, 한국 시간 0시) */
  renter: string | null;
  rentedAt: number | null;
}

export interface ParseResult {
  items: ParsedRental[];
  /** 읽지 못한 줄 (화면이 보여 준다) */
  skipped: string[];
  /** 글에서 읽은 직업들 */
  jobs: RentJob[];
}

const JOB_WORDS: [RegExp, RentJob][] = [
  [/전사/, "warrior"],
  [/레인저/, "ranger"],
  [/마법사/, "mage"],
  [/무도가/, "monk"],
];

/** 'yy.mm.dd' / 'mm.dd' -> 그날 한국 시간 0시 (연도가 없으면 기준 때의 해, 미래면 작년) */
function dateOf(yy: string | undefined, mm: string, dd: string, now: number): number | null {
  const m = Number(mm);
  const d = Number(dd);
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const kstYear = new Date(now + 9 * 3_600_000).getUTCFullYear();
  let y = yy ? 2000 + Number(yy) : kstYear;
  let at = Date.UTC(y, m - 1, d) - 9 * 3_600_000;
  if (!yy && at > now + 86_400_000) {
    y -= 1;
    at = Date.UTC(y, m - 1, d) - 9 * 3_600_000;
  }
  return at;
}

/** 대여무기 목록 글 -> 물건들. 직업 머리('… 전사.🔪')가 바뀌면 그 뒤는 그 직업 (네 직업 글을 이어 붙여도 된다) */
export function parseRentalList(text: string, now = Date.now()): ParseResult {
  const items: ParsedRental[] = [];
  const skipped: string[] = [];
  const jobs = new Set<RentJob>();
  let job: RentJob | null = null;
  let term: RentTerm = "none";
  let weapon: { level: number; name: string } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[​-‍﻿]/g, "").trim();
    if (!line || /^-+$/.test(line)) continue;
    // 직업 머리: '[sapphire 대여무기 목록] 전사.🔪'
    if (/대여무기|대여 무기/.test(line)) {
      const hit = JOB_WORDS.find(([re]) => re.test(line));
      if (hit) {
        job = hit[1];
        jobs.add(job);
        term = "none";
        weapon = null;
      }
      continue;
    }
    // 기한 칸: '‼️기한 제한없음‼️', '‼️기한 4주‼️'
    if (/기한/.test(line) && /ㅡ|‼|!/.test(line)) {
      const w = /(\d+)\s*주/.exec(line);
      term = w && termWeeks(`${Number(w[1])}w`) ? (`${Number(w[1])}w` as RentTerm) : "none";
      weapon = null;
      continue;
    }
    // 안내 줄 ('[닉네임] = 기부자', '[💎=1개당 10만gold]')
    if (/기부자|1개당|=\s*1개|gold/i.test(line) && !/\+\s*\d+\s*강/.test(line)) continue;
    // 무기: 'Lv.20[카타나]', 'Lv. 14[롱소드]', 'Lv23 [바이킹검]'
    const w = /^Lv\.?\s*(\d{1,3})\s*\[([^\]]+)\]/i.exec(line);
    if (w) {
      weapon = { level: Number(w[1]), name: w[2].trim() };
      continue;
    }
    // 물건: '[민초]명9 +7강 💎12', '[유어아너] 명3 +8강 💎40', '[오믈렛]명5 +6강 💎4 🆙춘천다크갈비 10.29'
    const it = /^\[([^\]]+)\]\s*(.*?)\s*\+\s*(\d{1,2})\s*강\s*💎\s*(\d{1,4})(.*)$/u.exec(line);
    if (it && job && weapon) {
      const rest = it[5];
      let renter: string | null = null;
      let rentedAt: number | null = null;
      const up = rest.indexOf("🆙");
      if (up >= 0) {
        const tail = rest.slice(up + 2).trim();
        // '춘천다크갈비 10.29' 또는 '26.10.22 혈천도마' / '10.31 간다이'
        const after = /^(\S+?)\s+(?:(\d{2})\.)?(\d{1,2})\.(\d{1,2})\.?$/.exec(tail);
        const before = /^(?:(\d{2})\.)?(\d{1,2})\.(\d{1,2})\.?\s+(\S+)$/.exec(tail);
        if (before) {
          renter = before[4];
          rentedAt = dateOf(before[1], before[2], before[3], now);
        } else if (after) {
          renter = after[1];
          rentedAt = dateOf(after[2], after[3], after[4], now);
        } else if (tail) renter = tail.split(/\s+/)[0];
      }
      items.push({
        job,
        term,
        level: weapon.level,
        weapon: weapon.name,
        options: it[2].replace(/\s+/g, "").replace(/면(\d)/g, "명$1"),
        enhance: Number(it[3]),
        price: Number(it[4]),
        donor: it[1].trim() || null,
        renter,
        rentedAt,
      });
      continue;
    }
    skipped.push(line);
  }
  return { items, skipped, jobs: [...jobs] };
}

/** 옵션 줄임말 -> [이름, 값] ('명6크3' -> [['명중', 6], ['크리티컬', 3]]). 마재(마나재생)를 마(마나)보다 먼저 본다 */
const OPTION_NAME: [string, string][] = [
  ["마재", "마나재생"],
  ["명", "명중"],
  ["크", "크리티컬"],
  ["힘", "힘"],
  ["민", "민첩"],
  ["지", "지능"],
  ["마", "마나"],
];
export function optionParts(options: string): [string, number][] {
  const out: [string, number][] = [];
  const re = /(마재|명|크|힘|민|지|마)\s*(\d{1,3})/g;
  for (let m = re.exec(options); m; m = re.exec(options)) out.push([OPTION_NAME.find(([k]) => k === m![1])![1], Number(m[2])]);
  return out;
}
