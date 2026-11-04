// 시세 동향 (개발중, 제작자 요청 2026-11-03): 제작자가 폰에서 내보낸 시리온 거래 톡방 대화를 자료로 만든 골드 시세와 물건 가격.
// 자료는 web/scripts/build_trend.py 가 자료/카톡/*.txt 에서 만든 data/trend.json (닉네임 없음, 로그인한 길드원에게만).
// 게임을 읽지 않고 사람들이 톡방에 쓴 글만 센다.
import { useCallback, useMemo, useState } from "react";
import type { PointerEvent } from "react";
import { loadTrend, useAsync } from "../data";
import type { GoldDay, Trend, TrendCat, TrendChar, TrendGroup, TrendItem, TrendPerson } from "../data";
import { MARKET_PIC, goldWords, wonText } from "../market";
import { Loading, Panel, PicImg, TopBar } from "../ui";
import type { Wiki } from "../types";
import { TrendDraft, draftOf } from "./TrendDraft";
import type { Draft } from "./TrendDraft";

/** 가격은 만 원 단위 (17 = 17만 원, 0.5 = 5000원) */
const priceText = (manwon: number) => wonText(Math.round(manwon * 10_000));
const goldText = (manwon: number, rate: number) => `≈ ${goldWords(Math.round(manwon * rate * 10_000))} 골드`;
/** '2026-10-12' -> '10/12' */
const md = (date: string) => date.slice(5).replace(/^0/, "").replace("-", "/").replace("/0", "/");

/** 날짜별 중간값들의 중간값 */
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
}

/** 오르고 내린 표: 10% 넘게 달라졌을 때만 (게임처럼 오르면 빨강, 내리면 파랑) */
function Change({ from, to, compact = false }: { from: number | null; to: number | null; compact?: boolean }) {
  if (from === null || to === null || !from) return null;
  const pct = Math.round(((to - from) / from) * 100);
  if (Math.abs(pct) < 10) return compact ? null : <span className="trend-flat">보합</span>;
  return (
    <span className={(pct > 0 ? "trend-up" : "trend-down") + (compact ? " trend-change-c" : "")}>
      {pct > 0 ? "▲" : "▼"}{compact ? "" : " "}{Math.abs(pct)}%
    </span>
  );
}

/** 날짜별 골드 시세 그림: 팝니다 중간값(파랑, 최소~최대 띠), 삽니다 중간값(금색). 날을 누르면 아래에 그날 값 */
function GoldChart({ days }: { days: GoldDay[] }) {
  const [pick, setPick] = useState<number | null>(null);
  const W = 340, H = 150, L = 26, R = 8, T = 10, B = 22;
  const values = days.flatMap((d) => [d.sell?.min, d.sell?.max, d.buy?.min, d.buy?.max]).filter((v): v is number => v != null);
  const lo = Math.min(...values) - 1, hi = Math.max(...values) + 1;
  const x = (i: number) => L + (days.length > 1 ? (i * (W - L - R)) / (days.length - 1) : (W - L - R) / 2);
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const line = (get: (d: GoldDay) => number | undefined) =>
    days.map((d, i) => (get(d) == null ? null : `${x(i).toFixed(1)},${y(get(d) as number).toFixed(1)}`)).filter(Boolean).join(" ");
  const band = (() => {
    const pts = days.map((d, i) => (d.sell ? { i, min: d.sell.q1, max: d.sell.q3 } : null)).filter((p): p is NonNullable<typeof p> => !!p);
    if (!pts.length) return "";
    return [...pts.map((p) => `${x(p.i).toFixed(1)},${y(p.max).toFixed(1)}`), ...pts.reverse().map((p) => `${x(p.i).toFixed(1)},${y(p.min).toFixed(1)}`)].join(" ");
  })();
  const ticks: number[] = [];
  for (let v = Math.ceil(lo); v <= hi; v++) if (v % 5 === 0) ticks.push(v);
  const every = Math.max(1, Math.ceil(days.length / 5));

  const onPointer = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * W;
      let best = 0;
      for (let i = 1; i < days.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
      setPick(best);
    },
    [days.length], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const last = days[days.length - 1];
  // 누르기 전에는 마지막 날 값
  const picked = pick === null ? last : days[pick];

  return (
    <div className="trend-chart">
      <div className="trend-legend">
        <span><i className="trend-dot trend-dot-sell" /> 팝니다</span>
        <span><i className="trend-dot trend-dot-buy" /> 삽니다</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="날짜별 골드 시세" onPointerDown={onPointer} onPointerMove={(e) => e.buttons && onPointer(e)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="trend-grid" />
            <text x={L - 4} y={y(v) + 3} className="trend-tick" textAnchor="end">{v}</text>
          </g>
        ))}
        {days.map((d, i) =>
          i === days.length - 1 || (i % every === 0 && days.length - 1 - i >= every / 2) ? (
            <text key={d.date} x={x(i)} y={H - 6} className="trend-tick" textAnchor={i === days.length - 1 ? "end" : i === 0 ? "start" : "middle"}>{md(d.date)}</text>
          ) : null,
        )}
        {band && <polygon points={band} className="trend-band" />}
        <polyline points={line((d) => d.sell?.med)} className="trend-line trend-line-sell" />
        <polyline points={line((d) => d.buy?.med)} className="trend-line trend-line-buy" />
        {pick !== null && <line x1={x(pick)} x2={x(pick)} y1={T} y2={H - B} className="trend-cursor" />}
        {last.sell && <circle cx={x(days.length - 1)} cy={y(last.sell.med)} r={3.5} className="trend-end trend-end-sell" />}
        {last.buy && <circle cx={x(days.length - 1)} cy={y(last.buy.med)} r={3.5} className="trend-end trend-end-buy" />}
      </svg>
      <div className="trend-pick muted">
        <b>{md(picked.date)}</b>
        {picked.sell && <> · 팝니다 <b>{picked.sell.med}:1</b> ({picked.sell.min}~{picked.sell.max}, {picked.sell.n}건)</>}
        {picked.buy && <> · 삽니다 <b>{picked.buy.med}:1</b> ({picked.buy.n}건)</>}
        {!picked.sell && !picked.buy && " · 시세 글 없음"}
      </div>
    </div>
  );
}

/** 최근 7일과 그 전 7일의 중간값 */
/** 가격 짧게 (칩, 표): 33만, 1.5만, 6700원 */
const shortWon = (manwon: number) =>
  manwon >= 10 ? `${Math.round(manwon)}만` : manwon >= 1 ? `${Math.round(manwon * 10) / 10}만` : `${Math.round(manwon * 10_000).toLocaleString("ko-KR")}원`;

/** 닉네임과 휴대폰 뒷자리 (있으면 초록 숫자 = 인증, 없으면 회색 '미인증'. 제작자 설명) */
function Who({ who, tel }: { who: string; tel: string }) {
  return (
    <span className="trend-who">
      {who}
      <small className={tel ? "trend-tel" : "trend-tel trend-tel-none"}>{tel || "미인증"}</small>
    </span>
  );
}

/** 올린 사람을 한 줄 칩들로 (싼 쪽부터, 가장 싼 사람 초록·가장 비싼 사람 빨강). recent 면 최신순 */
function PeopleChips({ people, value, recent = false, max = 12 }: { people: TrendPerson[]; value: (v: number) => string; recent?: boolean; max?: number }) {
  const [all, setAll] = useState(false);
  if (!people.length) return null;
  const list = recent ? [...people].sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : b.n - a.n)) : people;
  const meds = people.map((p) => p.med);
  const cheap = Math.min(...meds), dear = Math.max(...meds);
  const shown = all ? list : list.slice(0, max);
  return (
    <div className="trend-chips">
      {shown.map((p) => (
        <span key={p.who + p.tel} className={"trend-chip" + (cheap !== dear && p.med === cheap ? " trend-chip-cheap" : cheap !== dear && p.med === dear ? " trend-chip-dear" : "")}>
          <Who who={p.who} tel={p.tel} />
          <b>{value(p.med)}</b>
          <small className="muted">{p.n > 1 ? `${p.n}건 · ` : ""}{md(p.last)}</small>
        </span>
      ))}
      {list.length > max && (
        <button type="button" className="trend-chip trend-chip-more" onClick={() => setAll(!all)}>
          {all ? "접기" : `+${list.length - max}명`}
        </button>
      )}
    </div>
  );
}

/** 작은 추세선 (날짜별 중간값). 줄 오른쪽에 들어간다 */
function Spark({ days, cls = "" }: { days: [string, number][]; cls?: string }) {
  if (days.length < 2) return null;
  const W = 56, H = 20;
  const vs = days.map((d) => d[1]);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const x = (i: number) => 2 + (i * (W - 4)) / (days.length - 1);
  const y = (v: number) => (hi === lo ? H / 2 : 2 + ((hi - v) * (H - 4)) / (hi - lo));
  const pts = days.map((d, i) => `${x(i).toFixed(1)},${y(d[1]).toFixed(1)}`).join(" ");
  const last = days[days.length - 1][1];
  return (
    <svg className={"trend-spark " + cls} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <polyline points={pts} />
      <circle cx={x(days.length - 1)} cy={y(last)} r={2} />
    </svg>
  );
}

/** 최근 7일과 그 전 7일의 중간값 */
function weekMedians(days: GoldDay[], side: "sell" | "buy", lastWeek: string) {
  const recent = days.filter((d) => d.date >= lastWeek).map((d) => d[side]?.med).filter((v): v is number => v != null);
  const before = days.filter((d) => d.date < lastWeek).slice(-7).map((d) => d[side]?.med).filter((v): v is number => v != null);
  return { recent: median(recent), before: median(before) };
}

/** 골드: 요약 줄, 날짜 그림, 파는 사람·사는 사람 표 (최신순, 제작자 요청) */
function GoldPanel({ t }: { t: Trend }) {
  const sell = weekMedians(t.gold, "sell", t.lastWeek);
  const buy = weekMedians(t.gold, "buy", t.lastWeek);
  const posts = t.gold.reduce((s, d) => s + d.posts.sell + d.posts.buy, 0);
  const today = t.gold[t.gold.length - 1];
  const [who, setWho] = useState<"sell" | "buy">("sell");
  return (
    <Panel title="골드 시세">
      <div className="trend-stats">
        <div className="trend-stat">
          <span className="muted">팝니다 7일</span>
          <b>{sell.recent ?? "–"}:1</b>
          <Change from={sell.before} to={sell.recent} />
        </div>
        <div className="trend-stat">
          <span className="muted">삽니다 7일</span>
          <b>{buy.recent ?? "–"}:1</b>
          <Change from={buy.before} to={buy.recent} />
        </div>
        <div className="trend-stat">
          <span className="muted">{md(today.date)} 글</span>
          <b>{today.posts.sell + today.posts.buy}개</b>
          <span className="muted">전체 {posts} · 하루 {Math.round(posts / t.gold.length)}</span>
        </div>
      </div>
      <GoldChart days={t.gold} />
      <GoldBook t={t} now={sell.recent} />
      <div className="mk-sub trend-strip">
        <div className="mk-side" role="tablist">
          {(["sell", "buy"] as const).map((x) => (
            <button key={x} type="button" role="tab" aria-selected={who === x} className={"sub-tab" + (who === x ? " sub-tab-on" : "")} onClick={() => setWho(x)}>
              {x === "sell" ? "파는 사람" : "사는 사람"} <small>{t.goldPeople[x].length}</small>
            </button>
          ))}
        </div>
      </div>
      <GoldPeople key={who} people={t.goldPeople[who]} />
    </Panel>
  );
}

/** 골드 호가창 (제작자 2026-11-04 시세 동향 초안 C 에서 '저 골드 호가창만 추가, 아이디어 굳'): 시세(N:1)마다 파는 사람 수(왼쪽 파랑)와 사는 사람 수(오른쪽 빨강).
 *  지금 시세(팝니다 7일 중간값) 줄은 금색. 줄을 누르면 그 시세로 올린 사람 */
function GoldBook({ t, now }: { t: Trend; now: number | null }) {
  const [open, setOpen] = useState<number | null>(null);
  const rows = useMemo(() => {
    const m = new Map<number, { s: TrendPerson[]; b: TrendPerson[] }>();
    const add = (p: TrendPerson, k: "s" | "b") => {
      const r = Math.round(p.med);
      if (r < 60 || r > 90) return;
      const e = m.get(r) ?? { s: [], b: [] };
      e[k].push(p);
      m.set(r, e);
    };
    t.goldPeople.sell.forEach((p) => add(p, "s"));
    t.goldPeople.buy.forEach((p) => add(p, "b"));
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [t.goldPeople]);
  if (!rows.length) return null;
  const max = Math.max(...rows.map(([, e]) => Math.max(e.s.length, e.b.length)), 1);
  const cur = now === null ? null : Math.round(now);
  return (
    <div className="trend-book">
      <div className="trend-book-h"><span>파는 사람</span><span>N:1</span><span>사는 사람</span></div>
      {rows.map(([rate, e], i) => (
        <div key={rate} className="trend-book-item">
          <button
            type="button"
            className={"trend-book-row" + (rate === cur ? " trend-book-now" : "") + (open === rate ? " trend-book-open" : "")}
            style={{ animationDelay: `${Math.min(i, 14) * 30}ms` }}
            onClick={() => setOpen(open === rate ? null : rate)}
          >
            <span className="trend-book-l">
              <small>{e.s.length || ""}</small>
              <i style={{ width: `calc((100% - 24px) * ${e.s.length / max})` }} />
            </span>
            <b>{rate}</b>
            <span className="trend-book-r">
              <i style={{ width: `calc((100% - 24px) * ${e.b.length / max})` }} />
              <small>{e.b.length || ""}</small>
            </span>
          </button>
          {open === rate && (
            <div className="trend-book-who">
              {e.s.length > 0 && (
                <>
                  <small className="trend-book-side trend-book-side-s">파는 사람 {e.s.length}</small>
                  <PeopleChips people={e.s} value={(v) => `${v}:1`} recent />
                </>
              )}
              {e.b.length > 0 && (
                <>
                  <small className="trend-book-side trend-book-side-b">사는 사람 {e.b.length}</small>
                  <PeopleChips people={e.b} value={(v) => `${v}:1`} recent />
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** 골드 올린 사람 표: 닉 · 시세 · 글 · 마지막 날, 최신순. 가장 싼 값 초록, 가장 비싼 값 빨강 */
function GoldPeople({ people }: { people: TrendPerson[] }) {
  const [all, setAll] = useState(false);
  if (!people.length) return null;
  const list = [...people].sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : b.n - a.n));
  const meds = people.map((p) => p.med);
  const hiRate = Math.max(...meds), loRate = Math.min(...meds);
  const shown = all ? list : list.slice(0, 8);
  return (
    <div className="trend-tablebox">
      <table className="trend-table">
        <tbody>
          {shown.map((p) => (
            <tr key={p.who + p.tel}>
              <td><Who who={p.who} tel={p.tel} /></td>
              <td className={"trend-num" + (hiRate !== loRate && p.med === hiRate ? " trend-good" : hiRate !== loRate && p.med === loRate ? " trend-bad" : "")}>
                {p.med}:1{p.min !== p.max && <small className="muted"> {p.min}~{p.max}</small>}
              </td>
              <td className="trend-num muted">{p.n}</td>
              <td className="trend-num muted">{md(p.last)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length > 8 && (
        <button type="button" className="trend-linkbtn" onClick={() => setAll(!all)}>{all ? "접기" : `더 보기 (${list.length - 8})`}</button>
      )}
    </div>
  );
}

/** 칸 (제작자 2026-11-04 '전체 장비 장신구 스킬북 코스튬 기타 이렇게 나누자, 여러 명·최근·위키 다 없애'), 끝에 아무 정보도 없는 것 */
type Filter = "all" | TrendCat | "unknown";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "전체" },
  ...(["장비", "장신구", "스킬북", "코스튬", "기타"] as const).map((c) => ({ key: c, label: c })),
  { key: "unknown", label: "정보없음" },
];
const inFilter = (it: TrendItem, f: Filter) => (f === "all" ? true : f === "unknown" ? !!it.unknown : it.cat === f);
type Sort = "posts" | "price" | "recent";
const SORTS: { key: Sort; label: string }[] = [
  { key: "posts", label: "글 많은 순" },
  { key: "price", label: "비싼 순" },
  { key: "recent", label: "최근 순" },
];
const PAGE = 30;

/** 정렬은 띠 아래 오른쪽 작은 글자 (거르기 칸과 단계를 나눈다) */
function SortLine({ sort, onSort }: { sort: Sort; onSort: (k: Sort) => void }) {
  return (
    <div className="trend-sortline">
      {SORTS.map((f) => (
        <button key={f.key} type="button" className={sort === f.key ? "on" : ""} aria-pressed={sort === f.key} onClick={() => onSort(f.key)}>
          {f.label}
        </button>
      ))}
    </div>
  );
}

/** 물건의 묶음(속성별 / 강화 단계별)마다 날짜 그림 (제작자 요청 2026-11-03): 묶음 5개까지 한 줄씩, 날짜별 중간값(만 원). 누르면 그날 값 */
const SERIES_MAX = 5;
function ItemChart({ it }: { it: TrendItem }) {
  const [pick, setPick] = useState<number | null>(null);
  const series = it.groups.slice(0, SERIES_MAX);
  const dates = Array.from(new Set(series.flatMap((s) => s.days.map((d) => d[0])))).sort();
  const values = series.flatMap((s) => s.days.map((d) => d[1]));
  if (!dates.length || !values.length) return null;
  const vmin = Math.min(...values), vmax = Math.max(...values);
  const pad = Math.max((vmax - vmin) * 0.12, vmax * 0.05, 0.5);
  const lo = Math.max(0, vmin - pad), hi = vmax + pad;
  const W = 340, H = 150, L = 34, R = 8, T = 10, B = 22;
  const x = (i: number) => L + (dates.length > 1 ? (i * (W - L - R)) / (dates.length - 1) : (W - L - R) / 2);
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const idx = new Map(dates.map((d, i) => [d, i]));
  const step = (() => {
    const raw = (hi - lo) / 4;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
  })();
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(Math.round(t * 100) / 100);
  const every = Math.max(1, Math.ceil(dates.length / 5));
  const onPointer = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * W;
      let best = 0;
      for (let i = 1; i < dates.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
      setPick(best);
    },
    [dates.length], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const tickText = (v: number) => (v >= 1 ? `${Math.round(v * 10) / 10}만` : `${Math.round(v * 10000).toLocaleString("ko-KR")}`);
  return (
    <div className="trend-chart trend-item-chart">
      <div className="trend-legend">
        {series.map((s, k) => (
          <span key={s.label}><i className={`trend-dot trend-s${k}`} /> {s.label || "노작 · 노강"}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${it.name} 날짜별 가격`} onPointerDown={onPointer} onPointerMove={(e) => e.buttons && onPointer(e)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="trend-grid" />
            <text x={L - 4} y={y(t) + 3} className="trend-tick" textAnchor="end">{tickText(t)}</text>
          </g>
        ))}
        {dates.map((d, i) =>
          i === dates.length - 1 || (i % every === 0 && dates.length - 1 - i >= every / 2) ? (
            <text key={d} x={x(i)} y={H - 6} className="trend-tick" textAnchor={i === dates.length - 1 ? "end" : i === 0 ? "start" : "middle"}>{md(d)}</text>
          ) : null,
        )}
        {pick !== null && <line x1={x(pick)} x2={x(pick)} y1={T} y2={H - B} className="trend-cursor" />}
        {series.map((s, k) => (
          <g key={s.label} className={`trend-s${k}`}>
            {s.days.length > 1 && (
              <polyline points={s.days.map((d) => `${x(idx.get(d[0])!).toFixed(1)},${y(d[1]).toFixed(1)}`).join(" ")} className="trend-line" />
            )}
            {s.days.map((d) => (
              <circle key={d[0]} cx={x(idx.get(d[0])!)} cy={y(d[1])} r={3} className="trend-end" />
            ))}
          </g>
        ))}
      </svg>
      <div className="trend-pick muted">
        {/* 누르기 전에는 마지막 날 값 */}
        <b>{md(dates[pick ?? dates.length - 1])}</b>
        {series.map((s) => {
          const d = s.days.find((p) => p[0] === dates[pick ?? dates.length - 1]);
          return d ? <span key={s.label}> · {s.label || "노작"} <b>{priceText(d[1])}</b></span> : null;
        })}
      </div>
    </div>
  );
}


/** 물건 한 줄 (접힌 채로도 묶음별 가격이 보인다): 그림, 이름·줄임말, 묶음 칩(속성·강화마다 가격과 오르내림), 글·사람·기간, 가격, 추세선.
 *  펼치면 묶음별 날짜 그림과 표 */
function ItemRow({ it, t, wiki, side, open, onToggle }: { it: TrendItem; t: Trend; wiki: Wiki; side: "sell" | "buy"; open: boolean; onToggle: () => void }) {
  // 그림: 위키 아이템이면 위키 그림 (괄호 설명을 뗀 이름으로도 찾는다), 아니면 it.icon (도감 스샷에서 자른 그림, 스킬북은 위키 직업별 스킬의 아이콘), 그것도 없으면 동전
  const base = it.name.replace(/\s*\(.*\)\s*$/, "");
  const pic = (wiki.items[it.name] ?? wiki.items[base] ?? wiki.items[base.replace(/\s/g, "")])?.icon;
  const chips = it.groups.slice(0, 6);
  return (
    <li className={"trend-item" + (open ? " mk-open" : "")}>
      <button type="button" className="trend-itemrow" onClick={onToggle}>
        <span className="mk-slot trend-slot">
          {pic ? <PicImg pic={pic} max={30} /> : it.icon ? <img className="trend-icon" src={encodeURI(it.icon)} alt="" /> : <img className="mk-coin" src={MARKET_PIC + "coin.png"} alt="" />}
        </span>
        <span className="trend-itemmain">
          <span className="trend-itemtitle">
            <span className="row-title">{it.name}</span>
            <span className="trend-itemprice"><b>{priceText(it.med)}</b><Spark days={it.days} /></span>
          </span>
          <span className="trend-groupchips">
            {chips.map((g) => (
              <span key={g.label} className="trend-gchip">
                <em>{g.label}</em> {shortWon(g.med)}
                <Change from={g.before} to={g.recent} compact />
              </span>
            ))}
            {it.groups.length > chips.length && <span className="trend-gchip muted">+{it.groups.length - chips.length}</span>}
          </span>
          <span className="trend-sub muted">
            글 {it.n} · {it.sellers}명 · {md(it.first)}{it.first !== it.last && `~${md(it.last)}`} · {shortWon(it.min)}~{shortWon(it.max)}
            {it.other && <span className="trend-other"> · {side === "sell" ? "삽니다" : "팝니다"} {shortWon(it.other.med)} ({it.other.n})</span>}
            {it.abbr.length > 0 && <span className="trend-abbr"> · 톡방 {it.abbr.slice(0, 3).join(", ")}</span>}
          </span>
        </span>
      </button>
      {open && (
        <div className="trend-itembody">
          <ItemChart it={it} />
          <GroupTable it={it} t={t} />
        </div>
      )}
    </li>
  );
}

/** 묶음 표: 묶음 | 중간값 | 범위 | 글/명 | 7일. 줄을 누르면 올린 사람 칩, 옵션 묶음, 원글 */
function GroupTable({ it, t }: { it: TrendItem; t: Trend }) {
  const [open, setOpen] = useState<string | null>(it.groups.length === 1 ? it.groups[0].label : null);
  const head = it.kind === "enchant" ? "속성" : it.kind === "enhance" ? "강화" : "묶음";
  return (
    <table className="trend-table trend-grouptable">
      <thead>
        <tr><th>{head}</th><th className="trend-num">중간값</th><th className="trend-num">범위</th><th className="trend-num">글/명</th><th className="trend-num">7일</th></tr>
      </thead>
      <tbody>
        {it.groups.map((g) => (
          <GroupRows key={g.label} g={g} t={t} open={open === g.label} onToggle={() => setOpen(open === g.label ? null : g.label)} />
        ))}
      </tbody>
    </table>
  );
}

function GroupRows({ g, t, open, onToggle }: { g: TrendGroup; t: Trend; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className={"trend-grouprow" + (open ? " trend-grouprow-open" : "")} onClick={onToggle}>
        <td className="trend-glabel">{open ? "▾" : "▸"} {g.label}</td>
        <td className="trend-num"><b>{shortWon(g.med)}</b></td>
        <td className="trend-num muted">{g.min === g.max ? "–" : `${shortWon(g.min)}~${shortWon(g.max)}`}</td>
        <td className="trend-num muted">{g.n}/{g.sellers}</td>
        <td className="trend-num"><Change from={g.before} to={g.recent} compact /></td>
      </tr>
      {open && (
        <tr className="trend-groupdetail">
          <td colSpan={5}>
            <div className="trend-detailtitle muted">올린 사람 · {goldText(g.med, t.source.rate)}</div>
            <PeopleChips people={g.people} value={shortWon} />
            {g.variants.length > 1 && (
              <>
                <div className="trend-detailtitle muted">옵션 묶음</div>
                <div className="trend-chips">
                  {g.variants.map((v) => (
                    <span key={v.label} className="trend-chip">
                      <em>{v.label || "노작"}</em> <b>{shortWon(v.med)}</b>
                      <small className="muted">{v.n}건</small>
                    </span>
                  ))}
                </div>
              </>
            )}
            <div className="trend-detailtitle muted">원글</div>
            <ul className="trend-sample-list">
              {g.samples.map((s, i) => (
                <li key={i}>
                  <span className="muted">{md(s.date)}</span> <b>{shortWon(s.price)}</b> <Who who={s.who} tel={s.tel} /> <span className="trend-raw muted">{s.raw}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

/** 팝니다 = 파는 사람이 부른 값, 삽니다 = 사는 사람이 부른 값. 파는 쪽은 비싸게, 사는 쪽은 싸게 부르니 섞지 않는다 (제작자 지적) */
function ItemsPanel({ t, wiki }: { t: Trend; wiki: Wiki }) {
  const [q, setQ] = useState("");
  const [side, setSide] = useState<"sell" | "buy">("sell");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("posts");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const source = side === "sell" ? t.items : t.itemsBuy;
  const list = useMemo(() => {
    const needle = q.trim().replace(/\s/g, "").toLowerCase();
    const xs = source.filter(
      (it) =>
        inFilter(it, filter) &&
        (!needle || it.name.replace(/\s/g, "").toLowerCase().includes(needle) || it.abbr.some((a) => a.toLowerCase().includes(needle))),
    );
    if (sort === "price") xs.sort((a, b) => b.med - a.med);
    else if (sort === "recent") xs.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : b.n - a.n));
    return xs;
  }, [source, q, filter, sort]);
  const count = (f: Filter) => source.filter((it) => inFilter(it, f)).length;
  return (
    <Panel title={`물건 시세 (${list.length})`}>
      <div className="search-box">
        <input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="물건 이름 또는 톡방 줄임말" aria-label="물건 찾기" />
      </div>
      <div className="mk-sub trend-strip">
        <div className="mk-side" role="tablist">
          {(["sell", "buy"] as const).map((x) => (
            <button key={x} type="button" role="tab" aria-selected={side === x} className={"sub-tab" + (side === x ? " sub-tab-on" : "")}
              onClick={() => { setSide(x); setShown(PAGE); setOpen(null); }}>
              {x === "sell" ? "팝니다" : "삽니다"} <small>{(x === "sell" ? t.items : t.itemsBuy).length}</small>
            </button>
          ))}
        </div>
        <div className="mk-cats">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={"sub-tab" + (filter === f.key ? " sub-tab-on" : "")} onClick={() => { setFilter(f.key); setShown(PAGE); }}>
              {f.label} <small>{count(f.key)}</small>
            </button>
          ))}
        </div>
      </div>
      <SortLine sort={sort} onSort={(k) => { setSort(k); setShown(PAGE); }} />
      <ul className="mk-list trend-list">
        {list.slice(0, shown).map((it) => (
          <ItemRow key={side + it.name} it={it} t={t} wiki={wiki} side={side} open={open === it.name} onToggle={() => setOpen(open === it.name ? null : it.name)} />
        ))}
      </ul>
      {shown < list.length && (
        <button type="button" className="pill trend-more" onClick={() => setShown(shown + PAGE)}>
          더 보기 ({list.length - shown})
        </button>
      )}
    </Panel>
  );
}

type CharFilter = "all" | "char" | "bundle";
const CHAR_FILTERS: { key: CharFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "char", label: "캘" },
  { key: "bundle", label: "템통" },
];

/** 캐릭터 시세: 레벨대별 한 줄 요약과 캐릭터 줄 (레벨, 서버·직업·캘/템통, 닉, 스킬·보석·쟁·도감 칩, 도감 요약, 가격) */
function CharsPanel({ t }: { t: Trend }) {
  const [side, setSide] = useState<"sell" | "buy">("sell");
  const [filter, setFilter] = useState<CharFilter>("all");
  const [shown, setShown] = useState(PAGE);
  const bySide = t.chars.rows.filter((r) => r.side === side);
  const ofScope = (f: CharFilter) => bySide.filter((r) => (f !== "char" || r.scope === "캘") && (f !== "bundle" || r.scope === "템통"));
  const rows = ofScope(filter);
  return (
    <Panel title={`캐릭터 시세 (${rows.length})`}>
      <div className="mk-sub trend-strip">
        <div className="mk-side" role="tablist">
          {(["sell", "buy"] as const).map((x) => (
            <button key={x} type="button" role="tab" aria-selected={side === x} className={"sub-tab" + (side === x ? " sub-tab-on" : "")}
              onClick={() => { setSide(x); setShown(PAGE); }}>
              {x === "sell" ? "팝니다" : "삽니다"} <small>{t.chars.rows.filter((r) => r.side === x).length}</small>
            </button>
          ))}
        </div>
        <div className="mk-cats">
          {CHAR_FILTERS.map((f) => (
            <button key={f.key} type="button" className={"sub-tab" + (filter === f.key ? " sub-tab-on" : "")} onClick={() => { setFilter(f.key); setShown(PAGE); }}>
              {f.label} <small>{ofScope(f.key).length}</small>
            </button>
          ))}
        </div>
      </div>
      {/* 레벨대별 팝니다 중간값 (템통 제외) */}
      {side === "sell" && filter !== "bundle" && t.chars.bands.length > 0 && (
        <div className="trend-bands">
          {t.chars.bands.map((b) => (
            <span key={b.band} className="trend-gchip">
              <em>{b.band}</em> {shortWon(b.med)} <small className="muted">{b.n}개 · {shortWon(b.min)}~{shortWon(b.max)}</small>
            </span>
          ))}
        </div>
      )}
      <ul className="mk-list trend-list">
        {rows.slice(0, shown).map((r, i) => <CharRow key={i} r={r} />)}
      </ul>
      {shown < rows.length && (
        <button type="button" className="pill trend-more" onClick={() => setShown(shown + PAGE)}>
          더 보기 ({rows.length - shown})
        </button>
      )}
    </Panel>
  );
}

function CharRow({ r }: { r: TrendChar }) {
  const [open, setOpen] = useState(false);
  const skills = r.skills.split(" · ").filter(Boolean);
  const dexShort = r.dex.replace(/^도감 효과 · /, "").replace(/^도감 효과$/, "");
  return (
    <li className={"trend-item" + (open ? " mk-open" : "")}>
      <button type="button" className="trend-itemrow" onClick={() => setOpen(!open)}>
        <span className={"trend-lv" + (r.side === "buy" ? " trend-lv-buy" : "")}>
          <small>{r.side === "buy" ? "삽니다" : "팝니다"}</small>
          <b>{r.level}</b>
        </span>
        <span className="trend-itemmain">
          <span className="trend-itemtitle">
            <span className="row-title">{[r.server, r.job ?? "직업 모름", r.scope].filter(Boolean).join(" · ")}</span>
            <Who who={r.who} tel={r.tel} />
            <span className="trend-itemprice"><b>{priceText(r.price)}</b></span>
          </span>
          <span className="trend-groupchips">
            {skills.map((s) => <span key={s} className="trend-gchip trend-gchip-skill">{s}</span>)}
            {r.gems && <span className="trend-gchip">보석 <em>{r.gems}</em></span>}
            {r.pvp && <span className="trend-gchip trend-gchip-pvp">쟁캐</span>}
            {(r.dex === "노도감" || r.dex === "저도감") && <span className="trend-gchip muted">{r.dex}</span>}
            {"일반" in r.collect && <span className="trend-gchip">도감 <em>{r.collect["일반"]}%</em></span>}
            {!skills.length && !r.gems && !r.pvp && !r.dex && <span className="trend-gchip muted">상세 없음</span>}
          </span>
          <span className="trend-sub">
            {!open && dexShort && r.dex !== "노도감" && r.dex !== "저도감" && <span className="trend-dex">{dexShort}</span>}
            <span className="muted"> {md(r.first)}{r.first !== r.last && `~${md(r.last)}`}{r.n > 1 && ` · ${r.n}번`}</span>
          </span>
        </span>
      </button>
      {open && (
        <div className="trend-itembody trend-charbody">
          <div className="trend-raw muted">{r.raw}</div>
          {Object.keys(r.collect).length > 0 && (
            <div className="trend-chips">
              {["일반", "코스튬", "라이딩"].filter((k) => k in r.collect).map((k) => (
                <span key={k} className="trend-gchip">{k} <em>{r.collect[k]}%</em></span>
              ))}
            </div>
          )}
          {r.dexTable.length > 0 && (
            <dl className="trend-dexgrid">
              {r.dexTable.map(([k, v]) => (
                <div key={k}><dt className="muted">{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          )}
        </div>
      )}
    </li>
  );
}

type Tab = "gold" | "item" | "char";
const TABS: { key: Tab; label: string }[] = [
  { key: "gold", label: "골드" },
  { key: "item", label: "물건" },
  { key: "char", label: "캐릭터" },
];

/** 주소의 ?t= 로 칸을 기억한다 (#/trend?t=item). 없으면 골드 */
function tabFromHash(): Tab {
  const q = window.location.hash.split("?")[1] ?? "";
  const t = new URLSearchParams(q).get("t");
  return t === "item" || t === "char" ? t : "gold";
}

/** 골드 · 물건 · 캐릭터를 단추로 나눠 하나씩 본다 (제작자 요청 2026-11-03: 한 화면에 다 늘어놓지 않기) */
export function TrendPage({ wiki }: { wiki: Wiki }) {
  const { data: t, error } = useAsync(useCallback(() => loadTrend(), []));
  const [tab, setTab] = useState<Tab>(tabFromHash);
  // 디자인 초안 (feature 브랜치 전용, #/trend?draft=a)
  const [draft, setDraft] = useState<Draft | null>(draftOf);
  const pickDraft = (d: Draft) => {
    setDraft(d);
    window.history.replaceState(window.history.state, "", `${window.location.hash.split("?")[0] || "#/trend"}?draft=${d}`);
  };
  const pick = (k: Tab) => {
    setTab(k);
    const base = window.location.hash.split("?")[0] || "#/trend";
    window.history.replaceState(null, "", k === "gold" ? base : `${base}?t=${k}`);
  };
  return (
    <>
      <TopBar title="시세 동향" right={<span className="pill trend-dev">개발중</span>} />
      {!t ? (
        <Loading error={error?.includes("404") ? "시세 자료가 아직 없어요" : error} />
      ) : draft ? (
        <TrendDraft t={t} wiki={wiki} draft={draft} onDraft={pickDraft} />
      ) : (
        <>
          <nav className="pill-row trend-tabs" role="tablist">
            {TABS.map((x) => (
              <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} className={"pill" + (tab === x.key ? " pill-on" : "")} onClick={() => pick(x.key)}>
                {x.label}
              </button>
            ))}
          </nav>
          {tab === "gold" && <GoldPanel t={t} />}
          {tab === "item" && <ItemsPanel t={t} wiki={wiki} />}
          {tab === "char" && <CharsPanel t={t} />}
        </>
      )}
    </>
  );
}
