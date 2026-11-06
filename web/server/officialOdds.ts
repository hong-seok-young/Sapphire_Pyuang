// 공식 이벤트 글 그림 속 확률표 -> 확률 시뮬레이터 뽑기 상자 (제작자 2026-11-06 '시너지 다 하자'). GET /api/official/odds 가 쓴다.
// 공식 확률 페이지(data/odds.json)에 없는 이벤트 상자(과거의 기억, 남겨진흔적, 용사의 보물 …)의 확률은 이벤트 글 그림에만 있어서,
// 그림을 옮긴 글(official_img, 마크다운 표)에서 '확률' 칸이나 % 칸이 있고 합이 100% 인 표만 상자로 만든다. 같은 이벤트를 다시 안내한 글은 가장 새 글 것만.
// 표를 훑어서 D1 읽기가 커서 6시간 캐시한다 (functions/api/official/odds.ts). 공식 홈페이지 글일 뿐 게임은 읽지 않는다
import type { Env } from "./auth";
import { sameEvent } from "./official";

export interface EventBox {
  key: string;
  cat: string;
  name: string;
  /** 공식 글 번호와 올린 날 */
  post: number;
  date: string | null;
  sections: { title: string; items: { name: string; p: number }[] }[];
}
export const EVENT_CAT = "이벤트 공지";

const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.replace(/\s*\(빨간 글씨\)/g, "").replace(/\*\*/g, "").trim());
const isRule = (cells: string[]) => cells.every((c) => /^:?-{2,}:?$/.test(c));
const PCT = /^([\d.]+)\s*%$/;

/** 그림 글 하나의 확률표들 */
export function oddsTables(text: string): { title: string; items: { name: string; p: number }[] }[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: { title: string; items: { name: string; p: number }[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isTableLine(lines[i]) || (i > 0 && isTableLine(lines[i - 1]))) continue;
    let e = i;
    while (e + 1 < lines.length && isTableLine(lines[e + 1])) e++;
    const rows = lines
      .slice(i, e + 1)
      .map(cellsOf)
      .filter((r) => !isRule(r));
    // 표 바로 위의 제목 줄
    let t = i - 1;
    while (t >= 0 && !lines[t].trim()) t--;
    const title = t >= 0 && t >= i - 2 && !isTableLine(lines[t]) ? lines[t].replace(/\s*\(빨간 글씨\)/g, "").replace(/\*\*/g, "").replace(/^[-#*\s]+/, "").trim().slice(0, 80) : "";
    i = e;
    if (rows.length < 3) continue;
    const [head, ...body] = rows;
    // 확률 칸: 머리에 '확률'이 있거나 아래 칸이 거의 모두 'N%'
    const pcols = head
      .map((h, c) => ({ h, c, n: body.filter((r) => PCT.test(r[c] ?? "")).length }))
      .filter((x) => x.n >= body.length * 0.8 && x.n >= 2 && (x.h.includes("확률") || x.n === body.length));
    const ccol = head.findIndex((h) => /개수|수량/.test(h));
    // 제목: 표 위의 줄, 그리고 머리 칸이 상자 이름이면(용사의두번째보물) 그것도
    const GENERIC = /아이템|획득|이름|보상|구성|품목|종류|등급|개수|수량|확률|단계|번호/;
    const named = head.filter((h, k) => h && k !== ccol && !pcols.some((x) => x.c === k) && !GENERIC.test(h)).join(" · ");
    for (const { h, c } of pcols) {
      const items = body
        .map((r) => {
          const label = r.filter((_, k) => k !== c && k !== ccol && !pcols.some((x) => x.c === k) && r[k] && !/~~/.test(r[k])).join(" ");
          const n = ccol >= 0 ? (r[ccol] ?? "").replace(/^x/i, "") : "";
          const m = (r[c] ?? "").match(PCT);
          return { name: (n && n !== "1" ? `${label} x${n}` : label).trim(), p: m ? Number(m[1]) / 100 : 0 };
        })
        .filter((x) => x.name && x.p > 0);
      const sum = items.reduce((s, x) => s + x.p, 0);
      // 합이 100% 인 표만 (한 줄씩 따로 붙은 확률·성공 확률 표는 뽑기가 아니다)
      if (items.length < 2 || sum < 0.97 || sum > 1.03) continue;
      // 묶음 이름은 짧게: 상자 이름(머리 칸)이 있으면 그것, 없으면 표 위 줄에서 괄호 설명을 뺀 것
      const short = (named || title.replace(/\s*\([^)]*\)/g, "").trim()).slice(0, 40);
      out.push({ title: [short, pcols.length > 1 ? h : ""].filter(Boolean).join(" · ") || h, items });
    }
  }
  return out;
}

export async function eventBoxes(env: Env): Promise<EventBox[]> {
  const { results: imgs } = await env.DB.prepare("SELECT key, text FROM official_img WHERE text LIKE '%|%' AND text LIKE '%\\%%' ESCAPE '\\'").all<{
    key: string;
    text: string;
  }>();
  const tablesOf = new Map<string, ReturnType<typeof oddsTables>>();
  for (const g of imgs) {
    const t = oddsTables(g.text);
    if (t.length) tablesOf.set(g.key, t);
  }
  if (!tablesOf.size) return [];
  const { results: links } = await env.DB.prepare(
    "SELECT r.id, k.key AS idx, k.value AS key FROM official_rich r, json_each(r.keys) k WHERE k.value IN (SELECT value FROM json_each(?1))",
  )
    .bind(JSON.stringify([...tablesOf.keys()]))
    .all<{ id: number; idx: number; key: string }>();
  const ids = [...new Set(links.map((l) => l.id))];
  const { results: meta } = await env.DB.prepare("SELECT id, title, start_date FROM official_news WHERE id IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(ids))
    .all<{ id: number; title: string; start_date: string | null }>();
  const metaOf = new Map(meta.map((m) => [m.id, m]));
  // 그림은 그 그림을 쓴 가장 새 글에만, 같은 이벤트를 다시 안내한 글은 가장 새 글만
  const owner = new Map<string, number>();
  for (const l of links) if ((owner.get(l.key) ?? 0) < l.id) owner.set(l.key, l.id);
  const out: EventBox[] = [];
  for (const id of ids.sort((a, b) => b - a)) {
    const m = metaOf.get(id);
    if (!m || out.some((b) => sameEvent(b.name, m.title))) continue;
    const seen = new Set<string>();
    const sections = links
      .filter((l) => l.id === id && owner.get(l.key) === id)
      .sort((a, b) => a.idx - b.idx)
      .flatMap((l) => tablesOf.get(l.key) ?? [])
      .filter((s) => {
        const sig = s.title + JSON.stringify(s.items);
        return !seen.has(sig) && !!seen.add(sig);
      });
    if (sections.length) out.push({ key: `ev${id}`, cat: EVENT_CAT, name: m.title, post: id, date: m.start_date, sections });
  }
  return out.slice(0, 60);
}
