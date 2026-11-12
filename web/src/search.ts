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
