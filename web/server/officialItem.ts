// 아이템이 나오는 공식 글 (제작자 2026-11-06 '시너지 다 하자'): 위키 아이템 화면의 '공식 이벤트·소식' 칸 (GET /api/official/item?name=).
// 공식 글 그림 속 표·글자(official_img, scripts/read-official-images.mjs)와 본문(official_rich, 없으면 official_news.body)에서 아이템 이름을
// 띄어쓰기를 빼고 찾는다. 같은 이벤트를 몇 달마다 다시 안내한 글은 가장 새 글 하나와 '예전 회차 N'. 그 이름이 든 줄(표면 표 머리와 그 줄)만 보인다.
// 표 전체를 훑어서 D1 읽기가 커서(글 650여 개 + 그림 1,400여 장) 이름마다 6시간 캐시한다 (functions/api/official/item.ts). 공식 홈페이지 글일 뿐 게임은 읽지 않는다
import type { Env } from "./auth";
import { sameEvent } from "./official";

/** 띄어쓰기·줄바꿈을 뺀 글 (SQL) */
const bareSql = (col: string) => `lower(replace(replace(replace(replace(${col}, ' ', ''), char(10), ''), char(13), ''), char(9), ''))`;
const bare = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isRule = (l: string) => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(l);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface ItemEvent {
  id: number;
  kind: string;
  type: string;
  title: string;
  start: string | null;
  end: string | null;
  /** 진행 중인 이벤트 */
  ongoing: boolean;
  /** 그 이름이 든 줄 (표면 표 머리, 제목 줄과 함께. 마크다운) */
  text: string;
  /** 그림 속에서 찾았는지 */
  image: boolean;
  /** 같은 이벤트의 예전 회차 글 수 */
  older: number;
}

/** 조사 (이름 바로 뒤에 붙어도 그 이름으로 본다) */
const JOSA = new Set([..."을를이가은는의에도와과로만랑"]);

/**
 * 줄에 이름이 낱말로 드는지 (띄어쓰기는 상관없이). '전설의전리품 I' 은 '전설의전리품 II' 에 들지 않고, '마법의유물' 은 '마법의유물상자' 에 들지 않는다.
 * 앞 글자가 한글·영문이면(다른 이름의 끝) 빼고, 끝이 영문·숫자면 뒤에 영문·숫자가, 끝이 한글이면 뒤에 조사가 아닌 한글이 오면 뺀다
 */
export function hasName(line: string, name: string): boolean {
  const chars = [...name.replace(/\s+/g, "")];
  if (chars.length < 2) return false;
  const re = new RegExp(chars.map(esc).join("\\s*"), "gi");
  const latinEnd = /[A-Za-z0-9]/.test(chars[chars.length - 1]);
  for (const m of line.matchAll(re)) {
    const before = line[m.index - 1] ?? "";
    const after = line[m.index + m[0].length] ?? "";
    if (/[가-힣A-Za-z]/.test(before)) continue;
    if (latinEnd ? /[A-Za-z0-9]/.test(after) : /[가-힣]/.test(after) && !JOSA.has(after)) continue;
    return true;
  }
  return false;
}

/** 글에서 이름이 든 줄만: 표 줄이면 그 표의 제목 줄·머리·구분 줄과 함께, 한 글에서 8줄까지 */
export function snippet(text: string, name: string): string {
  const hit = (l: string) => hasName(l, name);
  const lines = text.replace(/\r/g, "").split("\n");
  const groups = new Map<string, string[]>();
  let rows = 0;
  for (let i = 0; i < lines.length && rows < 8; i++) {
    const line = lines[i];
    if (!hit(line)) continue;
    rows++;
    if (!isTableLine(line)) {
      groups.set(`p${i}`, [line.trim()]);
      continue;
    }
    let s = i;
    while (s > 0 && isTableLine(lines[s - 1])) s--;
    const id = `t${s}`;
    if (!groups.has(id)) {
      const head: string[] = [];
      // 표 바로 위의 제목 줄 ('직업이 전사일 경우 선택지')
      let t = s - 1;
      while (t >= 0 && !lines[t].trim()) t--;
      if (t >= 0 && t >= s - 2 && !isTableLine(lines[t]) && lines[t].trim().length <= 60) head.push(lines[t].trim());
      head.push(lines[s]);
      if (lines[s + 1] && isRule(lines[s + 1])) head.push(lines[s + 1]);
      groups.set(id, head);
    }
    if (i !== s && !isRule(line)) groups.get(id)!.push(line);
  }
  return [...groups.values()].map((g) => g.join("\n")).join("\n\n");
}

export async function itemEvents(env: Env, name: string, now = Date.now()): Promise<ItemEvent[]> {
  const key = bare(name);
  if (key.length < 2) return [];
  const [imgs, bodies] = await Promise.all([
    env.DB.prepare(`SELECT key, text FROM official_img WHERE text != '' AND instr(${bareSql("text")}, ?1) > 0`)
      .bind(key)
      .all<{ key: string; text: string }>(),
    env.DB.prepare(
      `SELECT n.id, COALESCE(r.text, n.body) AS text FROM official_news n LEFT JOIN official_rich r ON r.id = n.id WHERE instr(${bareSql("COALESCE(r.text, n.body)")}, ?1) > 0`,
    )
      .bind(key)
      .all<{ id: number; text: string }>(),
  ]);
  // 그림이 든 글
  const byPost = new Map<number, { texts: string[]; image: boolean }>();
  if (imgs.results.length) {
    const textOf = new Map(imgs.results.map((g) => [g.key, g.text]));
    const { results } = await env.DB.prepare("SELECT r.id, k.value AS key FROM official_rich r, json_each(r.keys) k WHERE k.value IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify([...textOf.keys()]))
      .all<{ id: number; key: string }>();
    for (const r of results) {
      const p = byPost.get(r.id) ?? { texts: [], image: true };
      p.texts.push(textOf.get(r.key)!);
      byPost.set(r.id, p);
    }
  }
  for (const b of bodies.results) {
    const p = byPost.get(b.id) ?? { texts: [], image: false };
    p.texts.unshift(b.text.replace(/⟦그림 \d+⟧/g, ""));
    byPost.set(b.id, p);
  }
  // 줄로 다시 확인 (두 글자 이름은 낱말로 있을 때만)
  const found = [...byPost].map(([id, p]) => ({ id, image: p.image, text: p.texts.map((t) => snippet(t, name)).filter(Boolean).join("\n\n") })).filter((p) => p.text);
  if (!found.length) return [];
  const ids = JSON.stringify(found.map((p) => p.id));
  const [meta, todo] = await Promise.all([
    env.DB.prepare("SELECT id, kind, type, title, start_date, end_date FROM official_news WHERE id IN (SELECT value FROM json_each(?1))")
      .bind(ids)
      .all<{ id: number; kind: string; type: string; title: string; start_date: string | null; end_date: string | null }>(),
    env.DB.prepare("SELECT id, until FROM official_todo WHERE id IN (SELECT value FROM json_each(?1))").bind(ids).all<{ id: number; until: number }>(),
  ]);
  const untilOf = new Map(todo.results.map((t) => [t.id, t.until]));
  const metaOf = new Map(meta.results.map((m) => [m.id, m]));
  const kst = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
  const today = kst(now);
  const threeWeeks = kst(now - 21 * 86_400_000);
  const out: ItemEvent[] = [];
  // 새 글부터: 같은 이벤트의 예전 회차는 가장 새 글에 수만 센다
  for (const p of found.sort((a, b) => b.id - a.id)) {
    const m = metaOf.get(p.id);
    if (!m) continue;
    const same = out.find((o) => sameEvent(o.title, m.title));
    if (same) {
      same.older++;
      continue;
    }
    const ongoing =
      m.kind === "event" &&
      (m.end_date ? m.end_date.slice(0, 10) >= today : untilOf.has(m.id) ? (untilOf.get(m.id) ?? 0) > now : (m.start_date ?? "") >= threeWeeks);
    out.push({ id: m.id, kind: m.kind, type: m.type, title: m.title, start: m.start_date, end: m.end_date, ongoing, text: p.text, image: p.image, older: 0 });
  }
  // 진행 중인 이벤트, 이벤트 글, 새 글 차례
  return out.sort((a, b) => Number(b.ongoing) - Number(a.ongoing) || Number(b.kind === "event") - Number(a.kind === "event") || b.id - a.id).slice(0, 8);
}
