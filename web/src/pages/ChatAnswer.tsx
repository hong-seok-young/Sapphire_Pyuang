import { Fragment, memo, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Wiki } from "../types";
import { monstersByName } from "../data";
import { PicImg, levelText } from "../ui";
import { ImageViewer } from "./ImageViewer";
import { TrendSnippet } from "./Trend";
import { DexSnippet } from "./Dex";
import type { ViewImage } from "./ImageViewer";
import { PLAT_PACKS } from "../platshop";

/**
 * 챗봇 답 그리기 (제작자 요청: 줄글만 말고 그림을 쓰고, 눌러서 그 화면으로 가게, 아이모 게임답게).
 * 서버의 시스템 프롬프트(functions/api/chat.ts)가 쓰게 한 표시를 바꿔 그린다.
 *   ## 소제목 / - 목록 / 1. 순서 / **굵게**
 *   [[아이템:이름]] [[몬스터:이름]] [[사냥터:이름]] [[메뉴:이름]] [[화면:이름]] -> 그림이 붙은 단추 (누르면 그 화면)
 *   [[질문:...]] -> 답 아래 추천 질문 단추 (누르면 바로 묻는다)
 * 위키에 없는 이름은 글자만 보인다. 답이 다 오기 전의 끊긴 표시는 글자로 둔다.
 * 보이는 모양 (제작자 요청 2026-11-06 '표 같은 걸 텍스트로만 대답해 버리면 안 돼, 이벤트에 뜬 사진을 직접 넣고, 누르면 전체 화면·확대·뒤로 가기로 챗봇'):
 *   [[그림:주소|설명]] -> 그 그림 (공식 글 그림만), 누르면 크게 보기 (ImageViewer: 손가락 확대, 뒤로 가기로 닫기)
 *   | 칸 | 칸 | (마크다운 표) -> 표 (옆으로 넘기기, 첫 칸 고정)
 *   [[탭:이름]] … [[탭끝]] -> 눌러서 바꾸는 탭 (직업별 교환표처럼)
 *   [[확률:제목|이름=98%;이름=1.94%]] -> 확률 막대
 *   [[계산기:대상=덥마북;확률=0.1304%;가격=570;최대=200;플골드=700;원골드=70]] -> 뽑기 계산기 (몇 개 살지 끌면 얻을 확률·플래티넘·현금·골드)
 *   [[도감:명중=4;체력=244.3;체력%=7.4]] -> 도감 계산기 칸: 그 능력치들을 처음부터 싼 순서로 채우는 골드·현금 (제작자 요청 2026-11-12, `Dex.tsx` `DexSnippet`)
 *   [[시세:물건 이름]] · [[시세:골드]] -> 시세 동향 화면의 그 물건 칸(날짜 그림 · 묶음 표 · 올린 사람 · 원글)이나 골드 시세 칸 그대로 (제작자 요청 2026-11-10)
 *   [[공식글:번호|제목]] -> 게시판 '아이모 소식'의 그 글로 가는 단추 (제작자 요청 2026-11-06: 이벤트를 물으면 그 글로 가서 직접 보게)
 */

type Kind = "아이템" | "몬스터" | "사냥터" | "메뉴" | "화면";

const SCREENS: Record<string, string> = {
  "길드 랭킹": "#/ranking", 랭킹: "#/ranking", "사파이어 중개인": "#/market", 중개인: "#/market", "길드원 의뢰소": "#/requests",
  의뢰소: "#/requests", 게시판: "#/board", "플래티넘 할인 상점": "#/shop", 상점: "#/shop", 검색: "#/search", "내 정보": "#/me",
  알림: "#/alerts", 장비: "#/equip", 사냥터: "#/places", 챗봇: "#/chat", 정보: "#/info", "공식 확률": "#/odds", "패치 내역": "#/patch",
  "길드원 관리": "#/admin", "사용 기록": "#/log", "To do": "#/todo", 투두: "#/todo", "할 일": "#/todo", "아이모 소식": "#/board?cat=imo",
  장비대여: "#/rent", "장비 대여": "#/rent", "길드 던전": "#/match", 길던: "#/match", "강화 비교": "#/enhance", "개발 요청": "#/devreq", 건의함: "#/suggest", 건의: "#/suggest", 성장코인샵: "#/gcoin", "성장 코인샵": "#/gcoin", "사기꾼 명단": "#/trend?t=scam",
};

interface Target {
  kind: Kind;
  name: string;
  to: string;
  icon: ReactNode;
  /** 아래 카드에 쓰는 한 줄 */
  sub?: string;
  /** 카드 그림 */
  big?: ReactNode;
}

const TOKEN = /\[\[(아이템|몬스터|사냥터|메뉴|화면|질문|모름|링크):([^\]\n]{1,700})\]\]/g;
/** 마크다운 링크 [제목](https://…) 도 링크 표시로 받는다 (챗봇 개선 2026-11-09: 웹에서 찾은 글의 링크를 달게) */
const MD_LINK = /\[([^[\]\n]{1,120})\]\((https?:\/\/[^)\s]{1,600})\)/g;
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^(www|m)\./, "");
  } catch {
    return url;
  }
};
const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function useResolver(wiki: Wiki) {
  return useMemo(() => {
    const byName = monstersByName(wiki);
    const placeByName = new Map(Object.values(wiki.places).map((p) => [squash(p.name), p]));
    const itemByName = new Map(Object.keys(wiki.items).map((n) => [squash(n), n]));
    const monsterNames = new Map([...byName.keys()].map((n) => [squash(n), n]));
    return (kind: Kind, raw: string): Target | null => {
      const key = squash(raw);
      if (kind === "아이템") {
        const name = itemByName.get(key);
        if (!name) return null;
        const it = wiki.items[name];
        const from = new Set(it.from.map((k) => wiki.monsters[k]?.name).filter(Boolean)).size;
        return {
          kind, name, to: "#/item/" + encodeURIComponent(name),
          icon: <PicImg pic={it.icon} fit={18} />, big: <PicImg pic={it.icon} fit={40} />,
          sub: [it.equip[0]?.slot, from ? `${from}마리가 떨굼` : ""].filter(Boolean).join(" · "),
        };
      }
      if (kind === "몬스터") {
        const name = monsterNames.get(key);
        if (!name) return null;
        const ms = byName.get(name) ?? [];
        const m = ms[0];
        const place = m && wiki.places[m.place];
        return {
          kind, name, to: "#/monster/" + encodeURIComponent(name),
          icon: <PicImg pic={m?.img} max={20} />, big: <PicImg pic={m?.img} max={44} />,
          sub: [m?.level ? `Lv.${m.level}` : "", place?.name ?? ""].filter(Boolean).join(" · "),
        };
      }
      if (kind === "사냥터") {
        // 지도 그림을 되풀이하지 않고 (제작자 요청) 그 사냥터에서 잡는 몬스터 그림을 붙인다: 단추는 가장 센 몬스터, 카드는 셋
        const p = placeByName.get(key);
        if (!p) return null;
        const mons = p.monsters
          .map((k) => wiki.monsters[k])
          .filter((m) => m?.img)
          .sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
        return {
          kind, name: p.name, to: "#/place/" + p.id,
          icon: mons[0] ? <PicImg pic={mons[0].img} max={20} /> : null,
          big: mons.length ? (
            <span className="ans-card-mons">
              {mons.slice(0, 3).map((m) => <PicImg key={m.key} pic={m.img} max={30} />)}
            </span>
          ) : undefined,
          sub: [levelText(p.level), p.region].filter(Boolean).join(" · "),
        };
      }
      if (kind === "메뉴") {
        const s = wiki.menu.find((m) => squash(m.title) === key);
        return s ? { kind, name: s.title, to: "#/menu/" + encodeURIComponent(s.title), icon: "📖" } : null;
      }
      const to = SCREENS[raw.trim()] ?? Object.entries(SCREENS).find(([n]) => squash(n) === key)?.[1];
      return to ? { kind, name: raw.trim(), to, icon: "🧭" } : null;
    };
  }, [wiki]);
}

/** 한 줄 안의 **굵게**, [[...]] */
function inline(text: string, resolve: ReturnType<typeof useResolver>, seen: Target[], keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  const pushText = (t: string) => {
    t.split(/(\*\*[^*\n]+\*\*)/).forEach((part, i) => {
      if (!part) return;
      out.push(
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <b key={`${keyBase}b${n}-${i}`}>{part.slice(2, -2)}</b> : <Fragment key={`${keyBase}t${n}-${i}`}>{part}</Fragment>,
      );
    });
  };
  text = text.replace(MD_LINK, (_all, title: string, url: string) => `[[링크:${url}|${title}]]`);
  for (const m of text.matchAll(TOKEN)) {
    pushText(text.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    n++;
    if (m[1] === "링크") {
      // 웹에서 찾은 글 (새 창으로. http(s) 주소만)
      const [url, title] = m[2].split("|");
      if (/^https?:\/\/[^\s]+$/.test(url.trim())) {
        out.push(
          <a key={`${keyBase}l${n}`} className="ans-chip ans-chip-link" href={url.trim()} target="_blank" rel="noopener noreferrer">
            <span className="ans-chip-icon">🔗</span>
            {(title || hostOf(url)).trim()}
          </a>,
        );
      } else out.push(<Fragment key={`${keyBase}l${n}`}>{title || url}</Fragment>);
      continue;
    }
    if (m[1] === "질문" || m[1] === "모름") continue; // 추천 질문은 아래로, 모르는 부분은 개발자에게 (아래 한 줄로만 알린다)
    const t = resolve(m[1] as Kind, m[2]);
    if (!t) {
      out.push(<b key={`${keyBase}x${n}`}>{m[2]}</b>);
      continue;
    }
    if (!seen.some((s) => s.to === t.to)) seen.push(t);
    out.push(
      <a key={`${keyBase}c${n}`} className={"ans-chip ans-chip-" + t.kind} href={t.to}>
        {t.icon && <span className="ans-chip-icon">{t.icon}</span>}
        {t.name}
      </a>,
    );
  }
  pushText(text.slice(last));
  return out;
}

/** 그림은 공식 홈페이지 그림과 이 사이트의 그림만 (답이 아무 주소나 넣지 못하게) */
const IMG_HOST = /^https:\/\/(hive-fn\.qpyou\.cn|[a-z0-9-]+\.googleusercontent\.com|([a-z0-9-]+\.)?withhive\.com)\//i;
const safeImg = (raw: string) => {
  const u = raw.trim();
  if (/^\/(img|data)\//.test(u)) return u;
  return IMG_HOST.test(u) ? u : null;
};
const IMG_TOKEN = /\[\[그림:([^\]|\n]{1,600})(?:\|([^\]\n]{0,120}))?\]\]/g;
const ODDS_TOKEN = /^\s*\[\[확률:([^\]\n]{1,800})\]\]\s*$/;
const CALC_TOKEN = /^\s*\[\[계산기:([^\]\n]{1,400})\]\]\s*$/;
const TREND_TOKEN = /^\s*(?:[-•]\s*)?\[\[시세:([^\]\n]{1,40})\]\]\s*$/;
const DEX_TOKEN = /^\s*(?:[-•]\s*)?\[\[도감:([^\]\n]{1,600})\]\]\s*$/;
const TAB_TOKEN = /^\s*\[\[탭:([^\]\n]{1,40})\]\]\s*$/;
const POST_TOKEN = /\[\[공식글:(\d{1,9})(?:\|([^\]\n]{0,120}))?\]\]/g;
const TAB_END = /^\s*\[\[탭끝\]\]\s*$/;

/** '0.1304%' -> 0.001304, '1/767' -> 0.0013, '98' -> 0.98 (1보다 크면 % 로 본다) */
function prob(raw: string): number | null {
  const t = raw.replace(/[,\s]/g, "");
  const frac = t.match(/^([\d.]+)\/([\d.]+)$/);
  const v = frac ? Number(frac[1]) / Number(frac[2]) : t.endsWith("%") ? Number(t.slice(0, -1)) / 100 : Number(t) > 1 ? Number(t) / 100 : Number(t);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : null;
}
const num = (raw: string | undefined) => {
  const v = Number(String(raw ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(v) && v > 0 ? v : null;
};
/** 12,345 / 1.2만 / 3.4억 */
function big(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(n >= 1e10 ? 0 : 2).replace(/\.?0+$/, "")}억`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, "")}만`;
  return Math.round(n).toLocaleString("ko-KR");
}
const pct = (p: number) => (p >= 0.999 ? "99.9%↑" : p >= 0.1 ? `${(p * 100).toFixed(1)}%` : p >= 0.001 ? `${(p * 100).toFixed(2)}%` : `${(p * 100).toFixed(4)}%`);

/** 확률 막대: [[확률:제목|이름=98%;이름=1.94%]] */
function OddsBars({ spec, render }: { spec: string; render: (t: string, k: string) => ReactNode[] }) {
  const [title, list] = spec.includes("|") ? [spec.slice(0, spec.indexOf("|")), spec.slice(spec.indexOf("|") + 1)] : ["", spec];
  const rows = list
    .split(/[;；]/)
    .map((x) => x.split("="))
    .filter((x) => x.length === 2)
    .map(([name, v]) => ({ name: name.trim(), p: prob(v) ?? 0, label: v.trim() }))
    .filter((r) => r.name);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.p)) || 1;
  return (
    <div className="ans-odds">
      {title && <b className="ans-odds-title">{render(title, "ot")}</b>}
      {rows.map((r, i) => (
        <div key={i} className="ans-odds-row">
          <span className="ans-odds-name">{render(r.name, `on${i}`)}</span>
          <span className="ans-odds-bar">
            <i style={{ width: `${Math.max(1.5, (r.p / max) * 100)}%` }} />
          </span>
          <span className="ans-odds-val">{r.label.includes("%") ? r.label : pct(r.p)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 뽑기 계산기 (제작자 요청 2026-11-06 '덥마북을 뽑는다고 하면 기대값, 얼마를 써야 되고, 현금이면, 골드면'):
 * 몇 개 살지 끌면 그만큼 샀을 때 하나라도 얻을 확률, 평균 몇 개, 플래티넘, 현금(13,000플 상품으로 가장 싸게 · 정가 1플 11원), 골드(플래티넘 시세 · 현금 시세)
 */
function GachaCalc({ spec }: { spec: string }) {
  const kv = Object.fromEntries(
    spec
      .split(/[;；]/)
      .map((x) => x.split("="))
      .filter((x) => x.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()]),
  );
  const p = prob(kv["확률"] ?? "");
  const price = num(kv["가격"]);
  const cap = num(kv["최대"]);
  const platGold = num(kv["플골드"]);
  const wonGold = num(kv["원골드"]);
  const name = kv["대상"] ?? "목표";
  const unit = kv["단위"] ?? "개";
  const n50 = p ? Math.ceil(Math.log(0.5) / Math.log(1 - p)) : 1;
  const n90 = p ? Math.ceil(Math.log(0.1) / Math.log(1 - p)) : 1;
  const mean = p ? Math.round(1 / p) : 1;
  const top = Math.min(1e6, Math.max(n90 * 1.5, cap ?? 0, 10));
  const [n, setN] = useState(() => Math.round(cap ?? mean));
  if (!p) return null;
  const toN = (v: number) => Math.max(1, Math.round(Math.exp((Math.log(top) * v) / 1000)));
  const toV = (x: number) => Math.round((Math.log(Math.max(1, x)) / Math.log(top)) * 1000);
  const got = 1 - Math.pow(1 - p, n);
  const plat = price ? n * price : null;
  const best = PLAT_PACKS[0].won / PLAT_PACKS[0].plat;
  const list = PLAT_PACKS[PLAT_PACKS.length - 1].won / PLAT_PACKS[PLAT_PACKS.length - 1].plat;
  const marks = [
    { at: n50, label: "50%" },
    { at: mean, label: "평균" },
    { at: n90, label: "90%" },
    ...(cap ? [{ at: cap, label: "구매 한도" }] : []),
  ].sort((a, b) => a.at - b.at);
  return (
    <div className="ans-calc">
      <div className="ans-calc-head">
        <b>{name}</b>
        <small>한 {unit}에 {pct(p)}</small>
      </div>
      <div className="ans-calc-n">
        <span>
          <b>{n.toLocaleString("ko-KR")}</b>
          {unit} 사면
        </span>
        <span className="ans-calc-got">
          얻을 확률 <b>{pct(got)}</b>
        </span>
      </div>
      <div className="ans-calc-meter" aria-hidden>
        <i style={{ width: `${got * 100}%` }} />
        <em style={{ left: "50%" }} />
        <em style={{ left: "90%" }} />
      </div>
      <input
        className="ans-calc-range"
        type="range"
        min={0}
        max={1000}
        value={toV(n)}
        onChange={(e) => setN(toN(Number(e.target.value)))}
        aria-label={`${name} 몇 ${unit} 살지`}
      />
      <div className="ans-calc-marks">
        {marks.map((m) => (
          <button key={m.label} className={"pill" + (n === m.at ? " pill-on" : "")} onClick={() => setN(m.at)}>
            {m.label} {m.at.toLocaleString("ko-KR")}
          </button>
        ))}
      </div>
      <dl className="ans-calc-out">
        <div>
          <dt>평균 나오는 수</dt>
          <dd>{(n * p).toFixed(n * p >= 10 ? 0 : 2)}개</dd>
        </div>
        {plat !== null && (
          <>
            <div>
              <dt>플래티넘</dt>
              <dd>{big(plat)}플</dd>
            </div>
            <div>
              <dt>현금</dt>
              <dd>
                {big(plat * best)}원 <small>~ {big(plat * list)}원</small>
              </dd>
            </div>
            {(platGold || wonGold) && (
              <div>
                <dt>골드</dt>
                <dd>
                  {platGold ? `${big(plat * platGold)}골드` : ""}
                  {wonGold && <small>{platGold ? " · " : ""}현금 시세 {big(plat * best * wonGold)}</small>}
                </dd>
              </div>
            )}
          </>
        )}
      </dl>
      {cap && n > cap && <p className="ans-calc-warn">한 캐릭터는 {cap.toLocaleString("ko-KR")}{unit}까지만 살 수 있어요</p>}
    </div>
  );
}

/** 눌러서 바꾸는 탭 */
function AnsTabs({ panels }: { panels: { name: string; nodes: ReactNode[] }[] }) {
  const [on, setOn] = useState(0);
  const cur = panels[Math.min(on, panels.length - 1)];
  return (
    <div className="ans-tabs">
      <div className="ans-tabs-bar" role="tablist">
        {panels.map((p, i) => (
          <button key={i} role="tab" aria-selected={i === on} className={"ans-tab" + (i === on ? " ans-tab-on" : "")} onClick={() => setOn(i)}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="ans-tabs-body" role="tabpanel">
        {cur?.nodes}
      </div>
    </div>
  );
}

const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isRule = (cells: string[]) => cells.every((c) => /^:?-{2,}:?$/.test(c));

function ChatAnswerView({ wiki, text, done, onAsk }: { wiki: Wiki; text: string; done: boolean; onAsk: (q: string) => void }) {
  const resolve = useResolver(wiki);
  const [viewing, setViewing] = useState<number | null>(null);
  const seen: Target[] = [];
  const images: ViewImage[] = [];
  const asks = [...text.matchAll(TOKEN)].filter((m) => m[1] === "질문").map((m) => m[2].trim());
  const render = (t: string, k: string) => inline(t, resolve, seen, k);

  /** 그림 한 장 (누르면 크게) */
  const picture = (src: string, caption: string | undefined, key: string) => {
    const at = images.push({ src, name: caption || undefined }) - 1;
    return (
      <figure key={key} className="ans-fig">
        <button className="ans-img" onClick={() => setViewing(at)} aria-label={`${caption || "그림"} 크게 보기`}>
          <img src={src} alt={caption ?? ""} loading="lazy" decoding="async" />
          <span className="ans-img-zoom">크게</span>
        </button>
        {caption && <figcaption>{render(caption, `${key}c`)}</figcaption>}
      </figure>
    );
  };

  /** 줄들을 그린다 (탭 안에서도 같은 것) */
  const blocksOf = (lines: string[], base: string): ReactNode[] => {
    const blocks: ReactNode[] = [];
    let list: { ordered: boolean; items: ReactNode[] } | null = null;
    let table: string[][] | null = null;
    const flushList = (i: number) => {
      if (!list) return;
      const Tag = list.ordered ? "ol" : "ul";
      blocks.push(<Tag key={`${base}l${i}`} className="ans-list">{list.items}</Tag>);
      list = null;
    };
    const flushTable = (i: number) => {
      if (!table) return;
      const rows = table.filter((r) => !isRule(r));
      table = null;
      if (!rows.length) return;
      const [headRow, ...bodyRows] = rows;
      const cols = Math.max(...rows.map((r) => r.length));
      blocks.push(
        <div key={`${base}t${i}`} className="ans-table">
          <table>
            <thead>
              <tr>
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c}>{render(headRow[c] ?? "", `${base}t${i}h${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((r, ri) => (
                <tr key={ri}>
                  {Array.from({ length: cols }, (_, c) => (
                    <td key={c}>{render(r[c] ?? "", `${base}t${i}r${ri}c${c}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    };
    const flush = (i: number) => {
      flushList(i);
      flushTable(i);
    };
    lines.forEach((raw, i) => {
      const line = raw.trimEnd();
      const onlyAsks = line.replace(TOKEN, (all, kind) => (kind === "질문" || kind === "모름" ? "" : all)).trim() === "" && /\[\[(질문|모름):/.test(line);
      if (onlyAsks) return;
      if (isTableLine(line)) {
        flushList(i);
        (table ??= []).push(cellsOf(line));
        return;
      }
      const dexm = line.match(DEX_TOKEN);
      if (dexm) {
        flush(i);
        blocks.push(<DexSnippet key={`${base}dx${i}`} spec={dexm[1]} />);
        return;
      }
      const trend = line.match(TREND_TOKEN);
      if (trend) {
        flush(i);
        blocks.push(<TrendSnippet key={`${base}tr${i}`} query={trend[1].trim()} wiki={wiki} />);
        return;
      }
      const odds = line.match(ODDS_TOKEN);
      const calc = line.match(CALC_TOKEN);
      if (odds || calc) {
        flush(i);
        blocks.push(odds ? <OddsBars key={`${base}o${i}`} spec={odds[1]} render={render} /> : <GachaCalc key={`${base}k${i}`} spec={calc![1]} />);
        return;
      }
      // 공식 글 단추가 든 줄: 글자는 문단으로, 단추는 그 아래에
      const posts = [...line.matchAll(POST_TOKEN)];
      if (posts.length) {
        flush(i);
        const rest = line.replace(POST_TOKEN, "").replace(/^\s*[-•]\s*$/, "").trim();
        if (rest) blocks.push(<p key={`${base}pp${i}`} className="ans-p">{render(rest, `${base}pp${i}`)}</p>);
        posts.forEach((m, j) =>
          blocks.push(
            <a key={`${base}post${i}-${j}`} className="ans-post" href={`#/official/${m[1]}`}>
              <span className="ans-post-tag">아이모 소식</span>
              <b>{m[2]?.trim() || "공식 글 보기"}</b>
              <span className="ans-post-go">글 보기 ›</span>
            </a>,
          ),
        );
        return;
      }
      // 그림 표시가 든 줄: 글자는 문단으로, 그림은 그 아래에 한 장씩
      const pics = [...line.matchAll(IMG_TOKEN)];
      if (pics.length) {
        flush(i);
        const rest = line.replace(IMG_TOKEN, "").replace(/^\s*[-•]\s*$/, "").trim();
        if (rest) blocks.push(<p key={`${base}gp${i}`} className="ans-p">{render(rest, `${base}gp${i}`)}</p>);
        pics.forEach((m, j) => {
          const src = safeImg(m[1]);
          if (src) blocks.push(picture(src, m[2]?.trim(), `${base}g${i}-${j}`));
        });
        return;
      }
      const head = line.match(/^#{1,4}\s+(.*)$/);
      const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (head) {
        flush(i);
        blocks.push(<h3 key={`${base}h${i}`} className="ans-h">{render(head[1], `${base}h${i}`)}</h3>);
      } else if (bullet || numbered) {
        flushTable(i);
        const ordered = !!numbered;
        if (!list || list.ordered !== ordered) {
          flushList(i);
          list = { ordered, items: [] };
        }
        list.items.push(<li key={`${base}i${i}`}>{render((bullet ?? numbered)![1], `${base}i${i}`)}</li>);
      } else if (line.trim() === "") {
        flush(i);
      } else {
        flush(i);
        blocks.push(<p key={`${base}p${i}`} className={"ans-p" + (line.startsWith("📍") ? " ans-route" : "")}>{render(line, `${base}p${i}`)}</p>);
      }
    });
    flush(lines.length);
    return blocks;
  };

  // 탭 묶음: [[탭:이름]] 줄부터 다음 탭이나 [[탭끝]] 까지가 한 칸, 이어진 탭들은 한 묶음
  const all = text.split("\n");
  const out: ReactNode[] = [];
  let plain: string[] = [];
  let tabs: { name: string; lines: string[] }[] | null = null;
  const endPlain = (i: number) => {
    if (plain.length) out.push(...blocksOf(plain, `s${i}`));
    plain = [];
  };
  const endTabs = (i: number) => {
    if (!tabs) return;
    const panels = tabs.map((t, j) => ({ name: t.name, nodes: blocksOf(t.lines, `tab${i}-${j}`) }));
    out.push(<AnsTabs key={`tabs${i}`} panels={panels} />);
    tabs = null;
  };
  all.forEach((line, i) => {
    const tab = line.match(TAB_TOKEN);
    if (tab) {
      endPlain(i);
      (tabs ??= []).push({ name: tab[1].trim(), lines: [] });
      return;
    }
    if (TAB_END.test(line)) {
      endTabs(i);
      return;
    }
    if (tabs) tabs[tabs.length - 1].lines.push(line);
    else plain.push(line);
  });
  endPlain(all.length);
  endTabs(all.length);

  const cards = seen.filter((t) => t.big).slice(0, 6);
  return (
    <div className="ans">
      {out}
      {done && cards.length > 0 && (
        <div className="ans-cards">
          {cards.map((c) => (
            <a key={c.to} className="ans-card" href={c.to}>
              <span className="ans-card-pic">{c.big}</span>
              <b>{c.name}</b>
              {c.sub && <small>{c.sub}</small>}
            </a>
          ))}
        </div>
      )}
      {done && /\[\[모름:/.test(text) && <div className="ans-gap">📝 자료가 모자란 부분은 개발자에게 알렸어요. 고치면 알려 드릴게요</div>}
      {done && asks.length > 0 && (
        <div className="ans-asks">
          {asks.slice(0, 3).map((q) => (
            <button key={q} className="pill" onClick={() => onAsk(q)}>
              💬 {q}
            </button>
          ))}
        </div>
      )}
      {viewing !== null && images.length > 0 && <ImageViewer images={images} start={Math.min(viewing, images.length - 1)} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** 답 하나 (글이 바뀔 때만 다시 그린다: 답이 흘러 들어오는 동안 앞의 답들은 그대로 둔다) */
export const ChatAnswer = memo(ChatAnswerView);
