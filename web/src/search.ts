import type { Wiki } from "./types";

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
const onlyCho = (s: string) => /^[ㄱ-ㅎ]+$/.test(s);

export interface Hit {
  kind: "item" | "monster" | "place";
  name: string;
  to: string;
  score: number;
}

function score(name: string, q: string): number {
  const n = norm(name);
  if (onlyCho(q)) {
    const c = chosung(n);
    if (c.startsWith(q)) return 3;
    return c.includes(q) ? 1 : 0;
  }
  if (n === q) return 5;
  if (n.startsWith(q)) return 3;
  return n.includes(q) ? 1 : 0;
}

export function search(wiki: Wiki, query: string, limit = 60): Hit[] {
  const q = norm(query);
  if (!q) return [];
  const hits: Hit[] = [];
  for (const name of Object.keys(wiki.items)) {
    const s = score(name, q);
    if (s) hits.push({ kind: "item", name, to: "#/item/" + encodeURIComponent(name), score: s + 0.2 });
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
  return hits.sort((a, b) => b.score - a.score || a.name.length - b.name.length).slice(0, limit);
}
