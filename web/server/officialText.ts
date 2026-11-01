// 컴투스 공식 글(withhive) HTML -> 표의 한 줄 (본문 글자, 간단한 HTML). 받는 곳이 둘이라 여기 하나로 둔다:
// scripts/fetch-official.mjs (GitHub Actions, 한국 PC 저장 파일)와 서버의 점검 글 새로 받기(server/official.ts refreshMaint, 점검 전광판).
// 둘이 다르게 바꾸면 서로 고쳐 쓰기를 되풀이하므로 이 파일만 고친다. Node 는 타입을 지우고 그대로 읽는다 (import ... .ts).
// 바꾸는 방법이 바뀌면 CONVERT 를 올린다: 받아 둔 글이 새 방법으로 다시 들어간다 (src 앞자리).

/** 바꾸는 방법의 판 (한 자리). 올리면 원문이 같아도 다시 고쳐 넣는다 */
export const CONVERT = "2";

const ENTITY: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};

/**
 * 줄 그은 글자를 <s>…</s> 로 모은다: <strike>, <s>, <del>, 그리고 style 에 line-through 가 든 태그.
 * 공식 점검 글은 연장되면 처음 시간을 줄 긋고 새 시간을 옆에 적는다 ('17:00~<strike>17:30</strike> 18:00'):
 * 글자(body)에서는 빼고(챗봇과 점검 전광판이 새 시간만 읽게), 화면(html)에서는 줄을 그어 보인다.
 * 같은 이름의 태그 깊이만 세어 닫는 자리를 찾는다 (span 안의 span 도)
 */
export function markStruck(html: string): string {
  let out = "";
  let last = 0;
  let open: { name: string; depth: number } | null = null;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [tag, close, rawName, rest] = m;
    const name = rawName.toLowerCase();
    if (!open) {
      const struck = !close && (name === "strike" || name === "s" || name === "del" || /line-through/i.test(rest));
      if (!struck || /\/\s*$/.test(rest)) continue;
      out += html.slice(last, m.index) + "<s>";
      last = re.lastIndex;
      open = { name, depth: 1 };
      continue;
    }
    // 줄 그은 칸 안: 안의 줄 긋기 태그는 버리고(이미 그었다), 같은 이름이면 깊이를 센다
    const inner = name === "strike" || name === "s" || name === "del";
    if (name === open.name) open.depth += close ? -1 : 1;
    if (open.depth === 0) {
      out += html.slice(last, m.index) + "</s>";
      last = re.lastIndex;
      open = null;
    } else if (inner) {
      out += html.slice(last, m.index);
      last = re.lastIndex;
    }
  }
  return out + html.slice(last) + (open ? "</s>" : "");
}

/** 공식 글의 HTML -> 글자 (줄은 남기고 그림, 꾸밈, 줄 그은 글자는 뺀다). 표는 칸을 ' | ' 로 */
export function htmlToText(html: string): string {
  return markStruck(String(html ?? ""))
    .replace(/<s>[\s\S]*?<\/s>/g, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|li|tr|table|h[1-6]|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITY[e.toLowerCase()] ?? m;
    })
    .replace(/[​-‍﻿]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\| *(\n|$)/g, "$1")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 그림, 링크 주소: https 만 (//로 시작하면 https 를 붙인다). 아니면 null */
function safeUrl(raw: string | null): string | null {
  const s = String(raw ?? "").trim().replace(/&amp;/g, "&");
  const full = s.startsWith("//") ? "https:" + s : s;
  try {
    const u = new URL(full);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href.replace(/"/g, "%22") : null;
  } catch {
    return null;
  }
}
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? m[2] ?? m[3] ?? m[4] : null;
};
/** 남기는 태그 (나머지는 태그만 빼고 글자는 둔다). 꾸밈 속성은 모두 뺀다. s 는 markStruck 이 모은 줄 그은 글자 */
const KEEP: Record<string, string> = {
  p: "p", div: "p", br: "br", b: "b", strong: "b", i: "i", em: "i", u: "u", s: "s", h1: "h4", h2: "h4", h3: "h4", h4: "h4", h5: "h4", h6: "h4",
  ul: "ul", ol: "ol", li: "li", table: "table", thead: "thead", tbody: "tbody", tr: "tr", td: "td", th: "th", hr: "hr", blockquote: "blockquote", img: "img", a: "a",
};

/** UTF-8 바이트 수 (D1 은 SQL 한 줄이 100KB 를 넘으면 받지 않는다. 한글은 한 글자 3바이트) */
const encoder = new TextEncoder();
export const bytes = (s: string | null | undefined) => encoder.encode(s ?? "").length;
/** max 바이트 안에 들어가게 뒤를 자른다 */
export function fitBytes(s: string, max: number): string {
  if (bytes(s) <= max) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bytes(s.slice(0, mid)) <= max) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo);
}

/** 공식 글 HTML -> 간단한 HTML (58KB 넘으면 null: 그때는 글자만 보인다) */
export function simpleHtml(html: string): string | null {
  const out = markStruck(String(html ?? ""))
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (tag, close: string, name: string) => {
      const t = KEEP[name.toLowerCase()];
      if (!t) return "";
      if (t === "img") {
        if (close) return "";
        const src = safeUrl(attr(tag, "src"));
        return src ? `<img src="${src}">` : "";
      }
      if (t === "a" && !close) {
        const href = safeUrl(attr(tag, "href"));
        return href ? `<a href="${href}">` : "<a>";
      }
      if (t === "br" || t === "hr") return close ? "" : `<${t}>`;
      return `<${close}${t}>`;
    })
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .replace(/<p>\s*(<br>\s*)*<\/p>/g, "")
    .trim();
  return bytes(out) > 58_000 ? null : out;
}

export const clean = (s: unknown) => String(s ?? "").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
const day = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** 짧은 해시 (FNV-1a 32비트, 36진수): 원문이 바뀌었는지만 본다 */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** withhive 목록의 글 하나 (POST /api/notice/list/32 의 notice_list 한 칸) */
export interface HiveItem {
  noticeId?: number | string;
  noticeTitle?: string;
  type?: string;
  cropImage?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  content?: string | null;
}

/** 표 official_news 의 한 줄 */
export interface OfficialRow {
  id: number;
  kind: "notice" | "event";
  type: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  image: string | null;
  body: string;
  html: string | null;
  /** 원문(제목+본문)의 해시와 바꾼 방법의 판: 같으면 다시 바꾸지 않는다 */
  src: string;
}

/** 원문의 표시 (제목과 본문이 같으면 같다) */
export const srcOf = (item: HiveItem) => `${CONVERT}:${hash(String(item.noticeTitle ?? "") + "\n" + String(item.content ?? ""))}`;

/** withhive 목록의 글 하나 -> 표의 한 줄 */
export function rowOf(item: HiveItem, kind: "notice" | "event"): OfficialRow {
  const crop = item.cropImage ? String(item.cropImage) : null;
  return {
    id: Number(item.noticeId),
    kind,
    type: item.type || (kind === "event" ? "E" : "N"),
    title: clean(item.noticeTitle),
    start_date: day(item.startTime),
    end_date: day(item.endTime),
    image: crop ? (crop.startsWith("//") ? "https:" + crop : crop) : null,
    body: fitBytes(htmlToText(item.content ?? ""), 22_000),
    html: simpleHtml(item.content ?? ""),
    src: srcOf(item),
  };
}

/**
 * 표에 넣는 SQL (값은 ?1 … ?11 순서: id, kind, type, title, start_date, end_date, image, body, fetched_at, html, src).
 * 원문이 바뀌었을 때만 고친다 (그대로면 쓰지 않아서 D1 쓰기 한도를 아낀다). 예전 방법(src 앞자리가 작은 것)으로 바꾼 것이 새 방법으로 바꾼 것을
 * 덮지 않는다 (한국 PC에서 예전에 받아 둔 파일을 배포가 넣을 때). 받은 때(fetched_at)가 더 늦은 글도 덮지 않는다: 파일은 받은 때를 저장한 때로 넣어서,
 * 그 뒤에 새로 받아 고친 글(연장된 점검 등)이 예전 내용으로 돌아가지 않는다. 원문이 바뀌면 To do 정리(official_todo)는 src 를 보고 다시 한다
 */
export const UPSERT_SQL =
  "INSERT INTO official_news (id, kind, type, title, start_date, end_date, image, body, fetched_at, html, src) " +
  "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) " +
  "ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, type = excluded.type, title = excluded.title, start_date = excluded.start_date, " +
  "end_date = excluded.end_date, image = excluded.image, body = excluded.body, fetched_at = excluded.fetched_at, html = excluded.html, src = excluded.src " +
  "WHERE excluded.src IS NOT NULL AND official_news.fetched_at <= excluded.fetched_at AND (official_news.src IS NULL OR " +
  "(official_news.src IS NOT excluded.src AND substr(excluded.src, 1, 1) >= substr(official_news.src, 1, 1)))";

/** UPSERT_SQL 에 넣는 값 (순서대로) */
export const upsertValues = (r: OfficialRow, now: number) =>
  [r.id, r.kind, r.type, r.title, r.start_date, r.end_date, r.image, r.body, now, r.html, r.src] as const;
