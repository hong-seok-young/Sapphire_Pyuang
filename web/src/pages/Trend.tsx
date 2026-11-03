// 시세 동향 (개발중, 제작자 요청 2026-11-03): 제작자가 폰에서 내보낸 시리온 거래 톡방 대화를 자료로 만든 골드 시세와 물건 가격.
// 자료는 web/scripts/build_trend.py 가 자료/카톡/*.txt 에서 만든 data/trend.json (닉네임 없음, 로그인한 길드원에게만).
// 게임을 읽지 않고 사람들이 톡방에 쓴 글만 센다.
import { useCallback, useMemo, useState } from "react";
import type { PointerEvent } from "react";
import { loadTrend, useAsync } from "../data";
import type { GoldDay, Trend, TrendChar, TrendGroup, TrendItem, TrendPerson, TrendVariant } from "../data";
import { MARKET_PIC, goldWords, wonText } from "../market";
import { FitLine, Loading, Panel, PicImg, TopBar } from "../ui";
import type { Wiki } from "../types";

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
function Change({ from, to }: { from: number | null; to: number | null }) {
  if (from === null || to === null || !from) return null;
  const pct = Math.round(((to - from) / from) * 100);
  if (Math.abs(pct) < 10) return <span className="trend-flat">보합</span>;
  return <span className={pct > 0 ? "trend-up" : "trend-down"}>{pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%</span>;
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
  const picked = pick === null ? null : days[pick];
  const last = days[days.length - 1];

  return (
    <div className="trend-chart">
      <div className="trend-legend">
        <span><i className="trend-dot trend-dot-sell" /> 팝니다 (띠는 가운데 절반)</span>
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
        {picked ? (
          <>
            <b>{md(picked.date)}</b>
            {picked.sell && <> · 팝니다 <b>{picked.sell.med}:1</b> ({picked.sell.min}~{picked.sell.max}, {picked.sell.n}건)</>}
            {picked.buy && <> · 삽니다 <b>{picked.buy.med}:1</b> ({picked.buy.n}건)</>}
            {!picked.sell && !picked.buy && " · 시세 글 없음"}
          </>
        ) : (
          "그림을 누르면 그날 값이 보여요"
        )}
      </div>
    </div>
  );
}

/** 최근 7일과 그 전 7일의 중간값 */
/** 닉네임과 휴대폰 뒷자리 (있으면 인증, 없으면 미인증. 제작자 설명) */
function Who({ who, tel }: { who: string; tel: string }) {
  return (
    <span className="trend-people-who">
      {who}
      <small className={tel ? "trend-tel" : "trend-tel trend-tel-none"}>{tel ? `${tel} 인증` : "미인증"}</small>
    </span>
  );
}

/** 올린 사람 목록: 닉네임, 값, 글 수, 마지막 날. recent 면 최신순 (제작자 요청: 골드는 최신순), 아니면 싼 쪽부터.
 *  값이 가장 싼 사람과 가장 비싼 사람에게 표시 */
function PeopleList({ title, people, value, recent = false }: { title: string; people: TrendPerson[]; value: (v: number) => string; recent?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!people.length) return null;
  const list = recent ? [...people].sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : b.n - a.n)) : people;
  const meds = people.map((p) => p.med);
  const cheap = Math.min(...meds), dear = Math.max(...meds);
  const mark = (p: TrendPerson) => (cheap === dear ? "" : p.med === cheap ? "trend-cheap" : p.med === dear ? "trend-dear" : "");
  return (
    <div className="trend-people">
      <button type="button" className={"pill" + (open ? " pill-on" : "")} onClick={() => setOpen(!open)}>
        {title} ({people.length})
      </button>
      {open && (
        <ul>
          {list.map((p) => (
            <li key={p.who + p.tel} className={mark(p)}>
              <Who who={p.who} tel={p.tel} />
              <span className="trend-sub muted">글 {p.n}개 · {md(p.last)}</span>
              <b>{value(p.med)}</b>
              {p.min !== p.max && <small className="muted">{value(p.min)} ~ {value(p.max)}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function weekMedians(days: GoldDay[], side: "sell" | "buy", lastWeek: string) {
  const recent = days.filter((d) => d.date >= lastWeek).map((d) => d[side]?.med).filter((v): v is number => v != null);
  const before = days.filter((d) => d.date < lastWeek).slice(-7).map((d) => d[side]?.med).filter((v): v is number => v != null);
  return { recent: median(recent), before: median(before) };
}

function GoldPanel({ t }: { t: Trend }) {
  const sell = weekMedians(t.gold, "sell", t.lastWeek);
  const buy = weekMedians(t.gold, "buy", t.lastWeek);
  const posts = t.gold.reduce((s, d) => s + d.posts.sell + d.posts.buy, 0);
  return (
    <Panel title="골드 시세 (1만 원에 몇 만 골드)">
      <div className="trend-stats">
        <div className="trend-stat">
          <span className="muted">팝니다 (7일)</span>
          <b>{sell.recent ?? "–"}:1</b>
          <Change from={sell.before} to={sell.recent} />
        </div>
        <div className="trend-stat">
          <span className="muted">삽니다 (7일)</span>
          <b>{buy.recent ?? "–"}:1</b>
          <Change from={buy.before} to={buy.recent} />
        </div>
        <div className="trend-stat">
          <span className="muted">골드 글</span>
          <b>{posts}개</b>
          <span className="muted">하루 {Math.round(posts / t.gold.length)}개</span>
        </div>
      </div>
      <GoldChart days={t.gold} />
      <p className="trend-note muted">숫자가 작을수록 비싼 골드 (70:1 = 1만 원에 70만 골드)</p>
      <PeopleList title="골드 파는 사람 (최신순)" people={t.goldPeople.sell} value={(v) => `${v}:1`} recent />
      <PeopleList title="골드 사는 사람 (최신순)" people={t.goldPeople.buy} value={(v) => `${v}:1`} recent />
    </Panel>
  );
}

type Filter = "all" | "many" | "recent" | "wiki" | "unknown";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "many", label: "여러 명이 올림" },
  { key: "recent", label: "최근 7일" },
  { key: "wiki", label: "위키 아이템" },
  { key: "unknown", label: "모르는 줄임말" },
];
const PAGE = 30;

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
        {it.groups.length > SERIES_MAX && <span className="muted">(앞의 {SERIES_MAX}묶음만)</span>}
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
        {pick !== null ? (
          <>
            <b>{md(dates[pick])}</b>
            {series.map((s) => {
              const d = s.days.find((p) => p[0] === dates[pick]);
              return d ? <span key={s.label}> · {s.label || "노작"} <b>{priceText(d[1])}</b></span> : null;
            })}
          </>
        ) : (
          "그림을 누르면 그날 값이 보여요 (세로는 만 원)"
        )}
      </div>
    </div>
  );
}

/** 물건 한 줄: 위키 이름(그림)과 톡방 줄임말, 가격 범위. 누르면 강화·옵션 묶음마다 가격, 묶음을 누르면 원글 한 줄 */
function ItemRow({ it, t, wiki, open, onToggle }: { it: TrendItem; t: Trend; wiki: Wiki; open: boolean; onToggle: () => void }) {
  const pic = (wiki.items[it.name] ?? wiki.items[it.name.replace(/\s/g, "")])?.icon;
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  return (
    <li className={open ? "mk-open" : ""}>
      <button type="button" className="mk-row trend-row" onClick={onToggle}>
        <span className="mk-slot trend-slot">{pic ? <PicImg pic={pic} max={30} /> : <img className="mk-coin" src={MARKET_PIC + "coin.png"} alt="" />}</span>
        <span className="row-main">
          <span className="row-title">
            {it.name}
            {it.abbr.length > 0 && <small className="trend-abbr muted"> {it.abbr.join(", ")}</small>}
          </span>
          <span className="trend-sub muted">
            글 {it.n}개 · {it.sellers}명 · {it.kind === "enchant" ? "속성" : it.kind === "enhance" ? "강화" : "묶음"} {it.groups.length}개 · {md(it.first)}{it.first !== it.last && `~${md(it.last)}`}
          </span>
        </span>
        <span className="trend-price">
          <b>{priceText(it.med)}</b>
          <small className="muted">{it.min === it.max ? goldText(it.med, t.source.rate) : `${priceText(it.min)} ~ ${priceText(it.max)}`}</small>
          {it.groups.length === 1 && <Change from={it.before} to={it.recent} />}
        </span>
      </button>
      {open && (
        <ul className="trend-vars">
          <li className="trend-vars-chart"><ItemChart it={it} /></li>
          {it.groups.map((g) => (
            <GroupRow key={g.label} g={g} t={t} open={openGroup === g.label} onToggle={() => setOpenGroup(openGroup === g.label ? null : g.label)} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** 묶음 한 줄 (속성부여 템은 '지능3', 강화 템은 '+8', 제작자 요청): 가격, 글 수, 오르내림. 누르면 올린 사람과 안의 옵션 묶음들 */
function GroupRow({ g, t, open, onToggle }: { g: TrendGroup; t: Trend; open: boolean; onToggle: () => void }) {
  const [openVar, setOpenVar] = useState<string | null>(null);
  return (
    <li>
      <button type="button" className={"trend-var trend-group" + (open ? " trend-var-open" : "")} onClick={onToggle}>
        <span className="trend-var-label">{g.label}</span>
        <span className="trend-sub muted">글 {g.n}개 · {g.sellers}명{g.variants.length > 1 && ` · 옵션 ${g.variants.length}개`}</span>
        <span className="trend-price">
          <b>{priceText(g.med)}</b>
          <small className="muted">{g.min === g.max ? goldText(g.med, t.source.rate) : `${priceText(g.min)} ~ ${priceText(g.max)}`}</small>
          <Change from={g.before} to={g.recent} />
        </span>
      </button>
      {open && (
        <div className="trend-group-body">
          <PeopleList title="올린 사람 (싼 사람부터)" people={g.people} value={priceText} />
          <ul className="trend-vars trend-vars-in">
            {g.variants.map((v) => (
              <VariantRow key={v.label} v={v} t={t} open={openVar === v.label} onToggle={() => setOpenVar(openVar === v.label ? null : v.label)} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/** 강화·옵션 묶음 한 줄 ('+8 지능3'): 가격, 글 수, 오르내림. 누르면 원글 한 줄들 */
function VariantRow({ v, t, open, onToggle }: { v: TrendVariant; t: Trend; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <button type="button" className={"trend-var" + (open ? " trend-var-open" : "")} onClick={onToggle}>
        <span className="trend-var-label">{v.label || "노작 · 노강"}</span>
        <span className="trend-sub muted">글 {v.n}개 · {v.sellers}명</span>
        <span className="trend-price">
          <b>{priceText(v.med)}</b>
          <small className="muted">{v.min === v.max ? goldText(v.med, t.source.rate) : `${priceText(v.min)} ~ ${priceText(v.max)}`}</small>
          <Change from={v.before} to={v.recent} />
        </span>
      </button>
      {open && (
        <div className="trend-samples trend-dexbox">
          <ul className="trend-sample-list">
            {v.samples.map((s, i) => (
              <li key={i}>
                <span className="muted">{md(s.date)}</span> <b>{priceText(s.price)}</b> <Who who={s.who} tel={s.tel} />{" "}
                <span className="trend-raw muted">{s.raw}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function ItemsPanel({ t, wiki }: { t: Trend; wiki: Wiki }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => {
    const needle = q.trim().replace(/\s/g, "").toLowerCase();
    return t.items.filter(
      (it) =>
        (filter !== "many" || it.sellers >= 2) &&
        (filter !== "recent" || it.last >= t.lastWeek) &&
        (filter !== "wiki" || it.wiki) &&
        (filter !== "unknown" || !it.wiki) &&
        (!needle || it.name.replace(/\s/g, "").toLowerCase().includes(needle) || it.abbr.some((a) => a.toLowerCase().includes(needle))),
    );
  }, [t, q, filter]);
  return (
    <Panel title={`물건 시세 (${list.length})`}>
      <div className="search-box">
        <input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="물건 이름 또는 톡방 줄임말" aria-label="물건 찾기" />
      </div>
      <div className="filter">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={"pill" + (filter === f.key ? " pill-on" : "")} onClick={() => { setFilter(f.key); setShown(PAGE); }}>
            {f.label}
          </button>
        ))}
      </div>
      <ul className="mk-list">
        {list.slice(0, shown).map((it) => (
          <ItemRow key={it.name} it={it} t={t} wiki={wiki} open={open === it.name} onToggle={() => setOpen(open === it.name ? null : it.name)} />
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

type CharFilter = "all" | "sell" | "buy" | "char" | "bundle";
const CHAR_FILTERS: { key: CharFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "sell", label: "팝니다" },
  { key: "buy", label: "삽니다" },
  { key: "char", label: "캘 (캐릭터만)" },
  { key: "bundle", label: "템통" },
];

/** 캐릭터 시세: 레벨대별 중간값과 글 한 줄씩 (서버, 레벨, 직업, 올마, 도감, 보석, 쟁캐, 캘/템통, 가격) */
function CharsPanel({ t }: { t: Trend }) {
  const [filter, setFilter] = useState<CharFilter>("all");
  const [shown, setShown] = useState(PAGE);
  const rows = t.chars.rows.filter(
    (r) =>
      (filter !== "sell" || r.side === "sell") &&
      (filter !== "buy" || r.side === "buy") &&
      (filter !== "char" || r.scope === "캘") &&
      (filter !== "bundle" || r.scope === "템통"),
  );
  return (
    <Panel title={`캐릭터 시세 (${rows.length})`}>
      {t.chars.bands.length > 0 && (
        <div className="trend-stats trend-bands">
          {t.chars.bands.map((b) => (
            <div key={b.band} className="trend-stat">
              <span className="muted">{b.band} 팝니다</span>
              <b>{priceText(b.med)}</b>
              <span className="muted">{b.n}개 · {priceText(b.min)} ~ {priceText(b.max)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="filter">
        {CHAR_FILTERS.map((f) => (
          <button key={f.key} type="button" className={"pill" + (filter === f.key ? " pill-on" : "")} onClick={() => { setFilter(f.key); setShown(PAGE); }}>
            {f.label}
          </button>
        ))}
      </div>
      <ul className="mk-list">
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
  const tags = [r.skills, r.gems && `보석 ${r.gems}`, r.pvp && "쟁캐"].filter(Boolean) as string[];
  return (
    <li className={open ? "mk-open" : ""}>
      <button type="button" className="mk-row trend-row" onClick={() => setOpen(!open)}>
        <span className={"trend-lv" + (r.side === "buy" ? " trend-lv-buy" : "")}>
          <small>{r.side === "buy" ? "삽니다" : "팝니다"}</small>
          <b>{r.level}</b>
        </span>
        <span className="row-main">
          <span className="row-title">
            <FitLine wrap={false} text={[r.server, r.job ?? "직업 모름", r.scope].filter(Boolean).join(" · ")} />
          </span>
          <span className="trend-sub"><Who who={r.who} tel={r.tel} /></span>
          <span className="trend-sub muted">{tags.length ? tags.join(" · ") : r.dex ? "" : "상세 없음"}{r.n > 1 && `${tags.length || !r.dex ? " · " : ""}${r.n}번 올림`}</span>
          {r.dex && <span className="trend-sub trend-dex">{r.dex}</span>}
        </span>
        <span className="trend-price">
          <b>{priceText(r.price)}</b>
          <small className="muted">{md(r.first)}{r.first !== r.last && `~${md(r.last)}`}</small>
        </span>
      </button>
      {open && (
        <div className="trend-samples trend-dexbox">
          <div className="trend-raw muted">{r.raw}</div>
          {Object.keys(r.collect).length > 0 && (
            <div className="trend-collect">
              {["일반", "코스튬", "라이딩"].filter((k) => k in r.collect).map((k) => (
                <span key={k}><span className="muted">{k}</span> <b>{r.collect[k]}%</b></span>
              ))}
            </div>
          )}
          {r.dexTable.length > 0 && (
            <table className="trend-dex-table">
              <thead><tr><th>도감 수집</th><th>값</th></tr></thead>
              <tbody>
                {r.dexTable.map(([k, v]) => (
                  <tr key={k}><td>{k}</td><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
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
      ) : (
        <>
          <div className="filter trend-tabs">
            {TABS.map((x) => (
              <button key={x.key} type="button" className={"pill" + (tab === x.key ? " pill-on" : "")} onClick={() => pick(x.key)}>
                {x.label}
              </button>
            ))}
          </div>
          {tab === "gold" && <GoldPanel t={t} />}
          {tab === "item" && <ItemsPanel t={t} wiki={wiki} />}
          {tab === "char" && <CharsPanel t={t} />}
          <p className="trend-src muted">
            시리온 거래 톡방 {t.source.rooms.length}곳 · {md(t.source.from)} ~ {md(t.source.to)} · 글 {t.source.messages.toLocaleString("ko-KR")}개 · 1장(콩) = 1만 원, 뒤에 붙은 숫자는 만 원 (300 이상은 만 골드),
            만 골드는 {t.source.rate}:1 로 바꿈. 줄임말은 위키 아이템 이름으로 풀었고 옵션(지3 = 지능3, 체3 = 체력30)과 강화마다 따로 셈
          </p>
        </>
      )}
    </>
  );
}
