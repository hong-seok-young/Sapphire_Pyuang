import type { Wiki } from "./types";
import type { Book } from "./data";

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

/** '현인의장갑' -> 'ㅎㅇㅇㅈㄱ' (한글이 아닌 글자는 그대로) */
export function chosung(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += code >= 0 && code < 11172 ? CHO[Math.floor(code / 588)] : ch;
  }
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

// ---------- 오타 찾기 (제작자 요청 2026-11-02: AI 없이 규칙으로) ----------
// 글자를 자모로 풀어('검은진액' -> ㄱㅓㅁㅇㅡㄴㅈㅣㄴㅇㅐㄱ) 한두 자모가 틀려도 찾는다: '검은진엑', '카타냐', '고대의반쥐'.
// 헷갈리기 쉬운 모음(ㅔ/ㅐ, ㅖ/ㅒ, ㅙ/ㅞ/ㅚ)은 같은 글자로 본다. 그냥 찾은 것이 적을 때만 더 찾는다 (search 의 FUZZY_BELOW)
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const SAME_VOWEL: Record<string, string> = { ㅔ: "ㅐ", ㅖ: "ㅒ", ㅙ: "ㅚ", ㅞ: "ㅚ" };

function jamo(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code >= 11172) {
      out += ch;
      continue;
    }
    const jung = JUNG[Math.floor((code % 588) / 28)];
    out += CHO[Math.floor(code / 588)] + (SAME_VOWEL[jung] ?? jung) + JONG[code % 28];
  }
  return out;
}

/** 두 글의 편집 거리. max 를 넘으면 더 세지 않고 max + 1 */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < low) low = cur[j];
    }
    if (low > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** 오타로 맞는지: 이름 전체나 이름 안의 비슷한 길이 토막과 자모 한두 개 차이. 맞으면 점수 (처음부터 맞으면 조금 높게) */
function fuzzy(name: string, q: string, qj: string): number {
  const n = norm(name);
  // 먼저 거르기: 질문 글자 중 이름에 있는 글자가 너무 적으면 보지 않는다
  const shared = [...q].filter((ch) => n.includes(ch)).length;
  if (shared < Math.max(1, q.length - 2)) return 0;
  const max = qj.length <= 6 ? 1 : qj.length <= 12 ? 2 : 3;
  const chars = [...n];
  for (let len = Math.max(1, q.length - 1); len <= q.length + 1; len++) {
    for (let start = 0; start + len <= chars.length || (start === 0 && chars.length < len); start++) {
      const piece = chars.slice(start, start + len).join("");
      if (distance(jamo(piece), qj, max) <= max) return start === 0 ? 0.8 : 0.5;
      if (chars.length < len) break;
    }
  }
  return 0;
}
/**
 * 글 제목 찾기 (아이모 소식, 제작자 요청 2026-11-06 '똑같은 단어만 말고 띄어쓰기 안 해도'): 띄어쓰기를 빼고, 낱말마다 제목에 들었거나 자모 한두 개 차이면 맞다.
 * 낱말이 모두 맞아야 한다. 맞으면 점수 (0 이면 아님)
 */
export function titleMatch(title: string, query: string): number {
  const words = query.split(/\s+/).map(norm).filter((w) => w.length >= 2);
  if (!words.length) return 0;
  const t = norm(title);
  let score = 1;
  for (const w of words) {
    if (t.includes(w)) continue;
    const f = fuzzy(title, w, jamo(w));
    if (!f) return 0;
    score = Math.min(score, f);
  }
  return score;
}

/** 그냥 찾은 것이 이보다 적으면 오타로도 찾는다 */
const FUZZY_BELOW = 5;
const onlyCho = (s: string) => /^[ㄱ-ㅎ]+$/.test(s);

export interface Hit {
  kind: "item" | "monster" | "place";
  name: string;
  to: string;
  score: number;
  /** 줄임말로 찾았으면 그 줄임말 ('고봉' -> 고대의봉) */
  via?: string;
}

function score(name: string, q: string): number {
  const n = norm(name);
  if (onlyCho(q)) {
    // 초성은 이름이나 낱말의 처음부터만 맞춘다. 중간까지 보면 'ㄷㅋ'에 레드크랩, '언더 크라운 전장'까지 걸린다
    if (chosung(n).startsWith(q)) return 3;
    const words = name.split(/[\s_()[\]·,:：/]+/).filter(Boolean);
    return words.some((w) => chosung(w).startsWith(q)) ? 2 : 0;
  }
  if (n === q) return 5;
  if (n.startsWith(q)) return 3;
  return n.includes(q) ? 1 : 0;
}

const itemTo = (name: string) => "#/item/" + encodeURIComponent(name);

/** 줄임말 표를 띄어쓰기 없는 소문자로 (책마다 한 번) */
const abbrOf = new WeakMap<Book, Map<string, [string, string[]]>>();
function abbrMap(book: Book): Map<string, [string, string[]]> {
  let m = abbrOf.get(book);
  if (!m) {
    m = new Map(Object.entries(book.abbr).map(([a, names]) => [norm(a), [a, names]]));
    abbrOf.set(book, m);
  }
  return m;
}

/** 오타 없이 그대로 맞는 것. book 이 있으면 위키에 없는 게임 아이템(코스튬·펫·소모품·상점 상품)과 줄임말도 */
function plainHits(wiki: Wiki, q: string, book?: Book | null): Hit[] {
  const hits: Hit[] = [];
  for (const [name, it] of Object.entries(wiki.items)) {
    let s = score(name, q);
    for (const a of it.aka ?? []) s = Math.max(s, score(a, q));
    if (s) hits.push({ kind: "item", name, to: itemTo(name), score: s + 0.2 });
  }
  if (book) {
    for (const name of Object.keys(book.items)) {
      if (wiki.items[name]) continue;
      const s = score(name, q);
      if (s) hits.push({ kind: "item", name, to: itemTo(name), score: s + 0.1 });
    }
    // 줄임말이 딱 맞으면 이름이 맞은 것 바로 아래에 ('고봉' -> 고대의봉)
    const ab = onlyCho(q) ? undefined : abbrMap(book).get(q);
    if (ab) {
      for (const name of ab[1]) {
        const had = hits.find((h) => h.kind === "item" && h.name === name);
        if (had) {
          had.score = Math.max(had.score, 4.6);
          had.via = ab[0];
        } else hits.push({ kind: "item", name, to: itemTo(name), score: 4.6, via: ab[0] });
      }
    }
  }
  const seen = new Set<string>();
  for (const m of Object.values(wiki.monsters)) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    const s = score(m.name, q);
    if (s) hits.push({ kind: "monster", name: m.name, to: "#/monster/" + encodeURIComponent(m.name), score: s + 0.3 });
  }
  for (const p of Object.values(wiki.places)) {
    const s = Math.max(score(p.name, q), score(p.title, q));
    if (s) hits.push({ kind: "place", name: p.name, to: "#/place/" + p.id, score: s + 0.4 });
  }
  return hits;
}

/**
 * book (아이템 책, data.ts loadBook)을 주면 위키 드랍표에 없는 게임 아이템과 줄임말도 찾는다 (제작자 2026-11-12 '검색이 챗봇 답변과 너무 상이해':
 * 챗봇은 자료 저장소를 다 읽는데 검색은 드랍표 아이템만 찾았다). 여러 낱말('고봉 숨옵')은 붙여서 아무것도 없을 때 낱말마다 찾아 합친다
 */
export function search(wiki: Wiki, query: string, limit = 60, book?: Book | null): Hit[] {
  const q = norm(query);
  if (!q) return [];
  let hits = plainHits(wiki, q, book);
  const words = query.trim().split(/\s+/).map(norm).filter((w) => [...w].length >= 2);
  let split = false;
  if (!hits.length && words.length > 1) {
    const best = new Map<string, Hit>();
    for (const w of words) {
      for (const h of plainHits(wiki, w, book)) {
        const key = h.kind + h.name;
        const old = best.get(key);
        // 낱말 여러 개가 맞은 것이 위로
        best.set(key, old ? { ...old, score: old.score + h.score, via: old.via ?? h.via } : h);
      }
    }
    hits = [...best.values()];
    split = hits.length > 0;
  }
  // 오타: 그냥 찾은 것이 적고 초성이 아닐 때만 (이름마다 자모 비교는 무거워서)
  // 두 글자는 틀린 자모 하나에도 엉뚱한 것이 많이 걸려서, 그냥 찾은 것이 하나도 없을 때만
  if (!split && !onlyCho(q) && ([...q].length >= 3 ? hits.length < FUZZY_BELOW : [...q].length === 2 && hits.length === 0)) {
    const qc = [...q].join("");
    const qj = jamo(qc);
    const have = new Set(hits.map((h) => h.kind + h.name));
    const add = (kind: Hit["kind"], name: string, to: string, extra: number, alt?: string) => {
      if (have.has(kind + name)) return;
      const f = Math.max(fuzzy(name, qc, qj), alt ? fuzzy(alt, qc, qj) : 0);
      if (f) {
        have.add(kind + name);
        hits.push({ kind, name, to, score: f + extra / 10 });
      }
    };
    for (const name of Object.keys(wiki.items)) add("item", name, itemTo(name), 0.2);
    if (book) for (const name of Object.keys(book.items)) if (!wiki.items[name]) add("item", name, itemTo(name), 0.1);
    for (const m of Object.values(wiki.monsters)) add("monster", m.name, "#/monster/" + encodeURIComponent(m.name), 0.3);
    for (const p of Object.values(wiki.places)) add("place", p.name, "#/place/" + p.id, 0.4, p.title);
  }
  return hits.sort((a, b) => b.score - a.score || a.name.length - b.name.length).slice(0, limit);
}

/** 위키 글 제목에서 찾기 (메뉴에 있는 글: 조합책, 강화, 스킬, 공략 …). 낱말이 모두 제목에 있어야 한다 (titleMatch) */
export function searchPosts(wiki: Wiki, query: string, limit = 8): { id: string; title: string; section: string }[] {
  if (norm(query).length < 2) return [];
  const out: { id: string; title: string; section: string; score: number }[] = [];
  const seen = new Set<string>();
  for (const m of wiki.menu) {
    if (m.equip) continue; // 장비 표는 아이템으로 찾는다
    for (const p of m.posts) {
      if (seen.has(p.id)) continue;
      const s = titleMatch(p.title, query);
      if (s) {
        seen.add(p.id);
        out.push({ id: p.id, title: p.title, section: m.title, score: s });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score || a.title.length - b.title.length).slice(0, limit);
}

// ---------- 이름 고르기 칸 (제작자 2026-11-12 '왜 템 검색이 안 돼, 템 검색하는 모든 곳에서 템 검색이 모두 잘 되게') ----------
// 기부함에서 '해니아'가 안 나왔다: 칸마다 위키 드랍표 아이템(items.json)만 '들어 있음'으로 찾아서, 아이템 책에만 있는 코스튬·펫·소모품과
// 줄임말('사멧'), 초성('ㅎㄴㅇ'), 오타('헤니아')를 못 찾았다. 검색 화면(search)과 같은 규칙을 이름 고르기 칸과 목록 거르기에도 쓴다.

export interface NameHit {
  name: string;
  score: number;
  /** 줄임말로 찾았으면 그 줄임말 ('사멧' -> 사나운멧돼지인형) */
  via?: string;
}

/** 이름 앞의 '+7 ', '7강 ' 같은 강화를 뗀다 (강화는 따로 적는 칸이 있다) */
const bare = (q: string) => q.replace(/^\+\d+\s*/, "").replace(/^\d+강\s*/, "");

/**
 * 이름 목록에서 고르기: 띄어쓰기·대소문자 상관없이 이름(과 다른 이름 aka)에 든 것, 초성, 줄임말(book.abbr), 그래도 적으면 자모 한두 개 틀린 오타까지.
 * bonus 는 같은 점수일 때 위로 올릴 이름 (위키 아이템 등). 처음부터 맞는 것, 짧은 이름이 위
 */
export function pickNames(
  query: string,
  names: Iterable<string>,
  o: { limit?: number; aka?: (name: string) => string[] | undefined; bonus?: (name: string) => number; book?: Book | null } = {},
): NameHit[] {
  const q = norm(bare(query.trim()));
  if (!q) return [];
  const limit = o.limit ?? 8;
  const all = [...new Set(names)];
  const best = new Map<string, NameHit>();
  const put = (name: string, s: number, via?: string) => {
    const old = best.get(name);
    if (!old || old.score < s) best.set(name, { name, score: s, via: via ?? old?.via });
  };
  for (const name of all) {
    let s = score(name, q);
    for (const a of o.aka?.(name) ?? []) s = Math.max(s, score(a, q));
    if (s) put(name, s + (o.bonus?.(name) ?? 0));
  }
  // 줄임말이 딱 맞거나 줄임말로 시작하면 ('사멧' -> 사나운멧돼지인형, '고봉' -> 고대의봉)
  if (o.book && !onlyCho(q)) {
    const inList = new Set(all);
    for (const [a, [shown, targets]] of abbrMap(o.book)) {
      const s = a === q ? 4.6 : a.length >= 2 && q.length >= 2 && a.startsWith(q) ? 2.5 : 0;
      if (!s) continue;
      // 줄임말 표시는 딱 맞을 때만 (앞만 맞은 '헤니아모' 같은 말까지 붙이면 어지럽다)
      for (const name of targets) if (inList.has(name)) put(name, s, a === q ? shown : undefined);
    }
  }
  // 오타: 그냥 찾은 것이 적을 때만 (두 글자는 하나도 없을 때만, search 와 같은 규칙)
  const len = [...q].length;
  if (!onlyCho(q) && (len >= 3 ? best.size < FUZZY_BELOW : len === 2 && best.size === 0)) {
    const qj = jamo(q);
    for (const name of all) {
      if (best.has(name)) continue;
      let f = fuzzy(name, q, qj);
      for (const a of o.aka?.(name) ?? []) f = Math.max(f, fuzzy(a, q, qj));
      if (f) put(name, f + (o.bonus?.(name) ?? 0) / 10);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.name.length - b.name.length).slice(0, limit);
}

/**
 * 게임 아이템 이름 고르기: 위키 아이템(다른 이름 포함) + 아이템 책에만 있는 게임 아이템(코스튬·펫·소모품·상점 상품 …) + 줄임말.
 * keep 으로 책 아이템을 거른다 (예: 중개인은 거래불가뿐인 것을 뺀다). 위키 아이템이 같은 점수면 위
 */
export function pickItems(wiki: Wiki | null | undefined, book: Book | null | undefined, query: string, limit = 8, keep?: (name: string) => boolean): NameHit[] {
  const names: string[] = wiki ? Object.keys(wiki.items) : [];
  if (book) for (const n of Object.keys(book.items)) if (!wiki?.items[n] && (!keep || keep(n))) names.push(n);
  const hits = pickNames(query, names, {
    limit,
    book,
    aka: (n) => wiki?.items[n]?.aka,
    bonus: (n) => (wiki?.items[n] ? 0.2 : 0.1),
  });
  // 부위 말을 바꿔 적은 이름도 추천에 ('리엘신발' -> 리엘의부츠, '회색리본머리띠' -> 회색리본머리핀. 제작자 2026-11-12, guessItem)
  if (hits.length < limit && [...norm(query)].length >= 3) {
    const g = guessItem(wiki, book, query);
    if (g && !hits.some((h) => h.name === g) && (wiki?.items[g] || !keep || keep(g))) hits.push({ name: g, score: 0.4 });
  }
  return hits;
}

/**
 * 목록 거르기 (도감·시세 동향·시뮬레이터 …): 이름들 중 하나라도 맞으면. 그냥 맞는 것(들어 있음·초성)이 적으면 오타로도.
 * names(x) 는 그 줄을 찾을 이름들 (항목 이름, 들어가는 아이템, 줄임말 …)
 */
export function filterByName<T>(list: T[], query: string, names: (x: T) => (string | undefined | null)[]): T[] {
  const q = norm(bare(query.trim()));
  if (!q) return list;
  const plain = list.filter((x) => names(x).some((n) => !!n && score(n, q) > 0));
  const len = [...q].length;
  if (onlyCho(q) || !(len >= 3 ? plain.length < FUZZY_BELOW : len === 2 && plain.length === 0)) return plain;
  const qj = jamo(q);
  const got = new Set(plain);
  return list.filter((x) => got.has(x) || names(x).some((n) => !!n && fuzzy(n, q, qj) > 0));
}

// ---------- 글에 적은 이름 -> 게임 아이템 이름 (그림 찾기) ----------
// 제작자 2026-11-12 '아이콘이 비어 있다, 제발 비지 않게': 중개인 글 '회색리본머리띠'(게임 이름 회색리본머리핀), '리엘신발'(리엘의부츠)처럼
// 길드원이 손으로 적은 이름이 게임 이름과 조금 달라 그림을 못 찾았다. 그대로 -> 꼬리표 떼기 -> 줄임말 -> 부위 말 바꾸기 -> 이름 고르기(들어 있음·오타) 차례로 찾는다.

type Part = "head" | "body" | "hands" | "feet" | "back" | "weapon" | "sub";
/** 이름 끝의 부위 말 (긴 말부터 본다). 한 글자 줄임말('해니아모', '드롤장')은 앞말이 두 글자 넘을 때만 */
const PART_WORDS: [Part, string[]][] = [
  ["feet", ["신발", "부츠", "장화", "구두", "덧신", "단화", "슈즈", "샌들", "발걸음", "신"]],
  ["head", ["머리띠", "머리핀", "머리끈", "모자", "투구", "헬멧", "두건", "왕관", "고깔", "리본", "모"]],
  ["hands", ["장갑", "건틀릿", "건틀렛", "글러브", "손덮개", "손아귀", "토시", "장"]],
  ["body", ["갑옷", "로브", "드레스", "아머", "경갑", "도복", "코트", "옷", "롭", "갑"]],
  ["back", ["망토", "날개", "케이프"]],
];
const SUFFIXES = PART_WORDS.flatMap(([p, ws]) => ws.map((w) => [w, p] as const)).sort((a, b) => b[0].length - a[0].length);
/** 위키 장비 부위·책의 고르기 -> 부위 */
const SLOT_PART: Record<string, Part> = {
  투구: "head", 모자: "head", 갑옷: "body", 장갑: "hands", 신발: "feet", 망토: "back",
  "전사 무기": "weapon", "레인저 무기": "weapon", "마법사 무기": "weapon", "무도가 무기": "weapon", 무기: "weapon", 주장비: "weapon",
  "보조 장비": "sub", 보조장비: "sub",
};
const GAME_TABS = new Set(["일반", "코스튬", "펫", "라이딩"]);

interface GuessIndex {
  /** 그림이 있는 게임 아이템 이름 (위키 + 책의 게임 아이템) */
  names: string[];
  /** 띄어쓰기 없는 이름 -> 이름 */
  squash: Map<string, string>;
  part: Map<string, Part>;
  memo: Map<string, string | null>;
}
const guessIdx = new WeakMap<object, WeakMap<object, GuessIndex>>();
const NO_BOOK = {};

function guessIndex(wiki: Wiki | null | undefined, book: Book | null | undefined): GuessIndex {
  const wk = (wiki ?? NO_BOOK) as object;
  const bk = (book ?? NO_BOOK) as object;
  let byBook = guessIdx.get(wk);
  if (!byBook) guessIdx.set(wk, (byBook = new WeakMap()));
  let g = byBook.get(bk);
  if (g) return g;
  const names: string[] = [];
  const part = new Map<string, Part>();
  const suffixPart = (n: string) => {
    const s = norm(n);
    for (const [w, p] of SUFFIXES) if (w.length >= 2 && s.endsWith(w)) return p;
    return undefined;
  };
  for (const [n, it] of Object.entries(wiki?.items ?? {})) {
    const p = SLOT_PART[it.equip?.[0]?.slot ?? ""] ?? suffixPart(n);
    if (p) part.set(n, p);
    if (it.icon) names.push(n);
  }
  for (const [n, vs] of Object.entries(book?.items ?? {})) {
    if (wiki?.items[n]?.icon) continue;
    const game = vs.filter((v) => GAME_TABS.has(v.t));
    if (!game.some((v) => v.pic)) continue;
    names.push(n);
    const p = game.map((v) => SLOT_PART[v.s ?? ""]).find(Boolean) ?? suffixPart(n);
    if (p && !part.has(n)) part.set(n, p);
  }
  g = { names, squash: new Map(names.map((n) => [norm(n), n])), part, memo: new Map() };
  byBook.set(bk, g);
  return g;
}

/** 강화(+8, 8강, 노강), 괄호 설명, 개수(x10, 10개), 앞뒤의 '코스튬'·'코튬' 을 뗀다 */
function guessKey(raw: string): string {
  return norm(
    raw
      .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
      .replace(/^\s*\+\d+\s*/, "")
      .replace(/^\s*(\d+강|노강)\s*/, "")
      .replace(/\s*[xX×]\s*\d[\d,]*\s*(개)?\s*$/, "")
      .replace(/\s*\d[\d,]*\s*개\s*$/, "")
      .replace(/^\s*(코스튬|코튬)\s*/, "")
      .replace(/\s*(코스튬|코튬)\s*$/, ""),
  );
}

/** 부위 말 바꾸기: '리엘신발' -> 앞말 '리엘' 로 시작하고 부위가 신발인 것 (리엘의부츠), '회색리본머리띠' -> 회색리본머리핀 */
function swapPart(g: GuessIndex, q: string): string | undefined {
  for (const [w, p] of SUFFIXES) {
    if (!q.endsWith(w) || q.length <= w.length) continue;
    const owner = q.slice(0, q.length - w.length).replace(/의$/, "");
    if ([...owner].length < (w.length === 1 ? 3 : 2)) continue;
    const hits = g.names.filter((n) => g.part.get(n) === p && norm(n).startsWith(owner));
    if (hits.length) return hits.sort((a, b) => a.length - b.length)[0];
  }
  return undefined;
}

/**
 * 손으로 적은 이름이 가리키는 게임 아이템 이름 (그림이 있는 것만). 못 찾으면 undefined.
 * 그림·종류 한마디를 붙이는 데만 쓴다 (글에 적은 이름은 그대로 둔다)
 */
export function guessItem(wiki: Wiki | null | undefined, book: Book | null | undefined, raw: string): string | undefined {
  const g = guessIndex(wiki, book);
  const q = guessKey(raw);
  if (!q) return undefined;
  const had = g.memo.get(q);
  if (had !== undefined) return had ?? undefined;
  const found = (() => {
    const exact = g.squash.get(q) ?? g.squash.get(norm(raw));
    if (exact) return exact;
    const ab = book ? abbrMap(book).get(q)?.[1].find((n) => g.squash.has(norm(n))) : undefined;
    if (ab) return g.squash.get(norm(ab));
    const swapped = swapPart(g, q);
    if (swapped) return swapped;
    const len = [...q].length;
    if (len < 2) return undefined;
    const hits = pickNames(q, g.names, { limit: 2, book, aka: (n) => wiki?.items[n]?.aka, bonus: (n) => (wiki?.items[n] ? 0.2 : 0.1) });
    const top = hits[0];
    if (!top) return undefined;
    // 앞이 맞거나 줄임말: 그대로. 이름 안에 든 것: 세 글자 넘고 이름이 많이 길지 않을 때만. 오타: 세 글자 넘고 하나로 갈릴 때만
    if (top.score >= 2.5) return top.name;
    if (top.score >= 1) return len >= 3 && [...norm(top.name)].length <= len + 3 ? top.name : undefined;
    return len >= 3 && (!hits[1] || hits[1].score < top.score) ? top.name : undefined;
  })();
  // 톡방처럼 강화를 이름 앞에 붙인 것 ('8헌보' = +8 헌터보우)
  const result = found ?? (/^\d{1,2}[가-힣]/.test(q) ? guessItem(wiki, book, q.replace(/^\d{1,2}/, "")) : undefined);
  g.memo.set(q, result ?? null);
  return result;
}
