// 시세 동향 디자인 초안 (제작자 요청 2026-11-04 '중복 정보 빼고 깔끔하게, 주식 느낌, 애니메이션 고급지게, 몇 개 안을 뽑아서 스샷').
// feature 브랜치 전용 초안: #/trend?draft=a|b|c. 고른 안을 Trend.tsx 에 옮긴 뒤 이 파일은 지운다.
// A 증권 앱 (지수 카드 + 종목 목록), B 시세 전광판 (흐르는 띠 + 캔들 + 히트맵), C 호가창 (매도·매수 깊이 + 급등·급락 카드 + 거래량 표).
// 한국 주식처럼 오르면 빨강, 내리면 파랑.
import { useEffect, useMemo, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import type { GoldDay, Trend, TrendItem } from "../data";
import { MARKET_PIC } from "../market";
import { PicImg } from "../ui";
import type { Wiki } from "../types";

const md = (date: string) => date.slice(5).replace(/^0/, "").replace("-", "/").replace("/0", "/");
const shortWon = (m: number) =>
  m >= 10 ? `${Math.round(m)}만` : m >= 1 ? `${Math.round(m * 10) / 10}만` : `${Math.round(m * 10_000).toLocaleString("ko-KR")}원`;
const reduce = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** 최근 7일과 그 전의 변화 % (둘 다 있을 때만) */
const pctOf = (before: number | null | undefined, now: number | null | undefined) =>
  before && now != null ? Math.round(((now - before) / before) * 1000) / 10 : null;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
}
function weekOf(days: GoldDay[], side: "sell" | "buy", lastWeek: string) {
  const recent = days.filter((d) => d.date >= lastWeek).map((d) => d[side]?.med).filter((v): v is number => v != null);
  const before = days.filter((d) => d.date < lastWeek).slice(-7).map((d) => d[side]?.med).filter((v): v is number => v != null);
  return { now: median(recent), before: median(before) };
}

/** 숫자가 0 에서 차오른다 (움직임 줄이기면 바로) */
function useCountUp(to: number, ms = 900, key: unknown = to) {
  const [v, setV] = useState(() => (reduce() ? to : 0));
  useEffect(() => {
    if (reduce()) {
      setV(to);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}
function CountUp({ value, digits = 0, suffix = "" }: { value: number; digits?: number; suffix?: string }) {
  const v = useCountUp(value);
  return <>{v.toFixed(digits)}{suffix}</>;
}

/** ▲ 5.2% / ▼ 3% / 0.0% */
function Pct({ p, pill = false, big = false }: { p: number | null; pill?: boolean; big?: boolean }) {
  if (p === null) return <span className="td-flat">–</span>;
  const cls = p > 0 ? "td-up" : p < 0 ? "td-down" : "td-flat";
  return (
    <span className={`${cls}${pill ? " td-pill" : ""}${big ? " td-big" : ""}`}>
      {p > 0 ? "▲" : p < 0 ? "▼" : ""}
      {Math.abs(p).toFixed(Math.abs(p) >= 10 ? 0 : 1)}%
    </span>
  );
}

function ItemPic({ it, wiki, size = 26 }: { it: TrendItem; wiki: Wiki; size?: number }) {
  const base = it.name.replace(/\s*\(.*\)\s*$/, "");
  const pic = (wiki.items[it.name] ?? wiki.items[base] ?? wiki.items[base.replace(/\s/g, "")])?.icon;
  return (
    <span className="td-pic" style={{ width: size + 6, height: size + 6 }}>
      {pic ? <PicImg pic={pic} max={size} /> : it.icon ? <img src={encodeURI(it.icon)} alt="" /> : <img src={MARKET_PIC + "coin.png"} alt="" />}
    </span>
  );
}

/** 선 그림: 선이 왼쪽에서 그려지고 아래가 은은하게 채워진다. 누르고 끌면 그날 값 */
function LineChart({
  pts,
  sub,
  h = 120,
  fmt,
  dir,
}: {
  pts: { label: string; v: number }[];
  sub?: (number | null)[];
  h?: number;
  fmt: (v: number) => string;
  dir: number;
}) {
  const [pick, setPick] = useState<number | null>(null);
  const W = 340, H = h, T = 14, B = 16;
  const all = [...pts.map((p) => p.v), ...(sub ?? []).filter((v): v is number => v != null)];
  if (pts.length < 2) return null;
  const lo0 = Math.min(...all), hi0 = Math.max(...all);
  const pad = Math.max((hi0 - lo0) * 0.15, hi0 * 0.01, 0.2);
  const lo = lo0 - pad, hi = hi0 + pad;
  const x = (i: number) => 4 + (i * (W - 8)) / (pts.length - 1);
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = `${d}L${x(pts.length - 1).toFixed(1)},${H - B}L${x(0).toFixed(1)},${H - B}Z`;
  const subD = sub
    ?.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  const tone = dir > 0 ? "up" : dir < 0 ? "down" : "flat";
  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setPick(best);
  };
  const hiI = pts.reduce((b, p, i) => (p.v > pts[b].v ? i : b), 0);
  const loI = pts.reduce((b, p, i) => (p.v < pts[b].v ? i : b), 0);
  const p = pick === null ? null : pts[pick];
  return (
    <div className="td-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={`td-line-${tone}`}
        onPointerDown={onPointer}
        onPointerMove={(e) => e.buttons && onPointer(e)}
        onPointerLeave={() => setPick(null)}
        role="img"
      >
        <defs>
          <linearGradient id={`tdg-${tone}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="td-stop-a" />
            <stop offset="1" className="td-stop-b" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((k) => (
          <line key={k} x1={0} x2={W} y1={T + k * (H - T - B)} y2={T + k * (H - T - B)} className="td-grid" />
        ))}
        <path d={area} fill={`url(#tdg-${tone})`} className="td-area" />
        {subD && <polyline points={subD} className="td-sub" />}
        <path d={d} pathLength={1} className="td-path" />
        <text x={x(hiI)} y={y(pts[hiI].v) - 4} className="td-mark" textAnchor={hiI > pts.length * 0.7 ? "end" : hiI < pts.length * 0.3 ? "start" : "middle"}>
          최고 {fmt(pts[hiI].v)}
        </text>
        <text x={x(loI)} y={y(pts[loI].v) + 11} className="td-mark" textAnchor={loI > pts.length * 0.7 ? "end" : loI < pts.length * 0.3 ? "start" : "middle"}>
          최저 {fmt(pts[loI].v)}
        </text>
        <text x={2} y={H - 3} className="td-axis">{pts[0].label}</text>
        <text x={W - 2} y={H - 3} className="td-axis" textAnchor="end">{pts[pts.length - 1].label}</text>
        {p && pick !== null && (
          <g>
            <line x1={x(pick)} x2={x(pick)} y1={T - 4} y2={H - B} className="td-cursor" />
            <circle cx={x(pick)} cy={y(p.v)} r={4} className="td-dot" />
          </g>
        )}
        <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].v)} r={3.5} className="td-dot td-pulse" />
      </svg>
      {p && (
        <span className="td-bubble" style={{ left: `${(x(pick!) / W) * 100}%` }}>
          {p.label} <b>{fmt(p.v)}</b>
        </span>
      )}
    </div>
  );
}

/** 물건의 7일 변화: 묶음(+8, 지능3 …)을 섞으면 싼 묶음 글이 많은 주에 값이 튀어서, 글이 가장 많은 묶음 하나로 잰다 */
function mainOf(it: TrendItem) {
  const gs = it.groups.filter((g) => g.before != null && g.recent != null);
  return gs.length ? gs.reduce((a, b) => (b.n > a.n ? b : a)) : null;
}
const pctItem = (it: TrendItem) => {
  const g = mainOf(it);
  return g ? pctOf(g.before, g.recent) : null;
};
const movers = (items: TrendItem[]) =>
  items
    .map((it) => ({ it, g: mainOf(it), p: pctItem(it) }))
    // 네 배 넘게 뛴 값은 잘못 읽은 글(가격 단위)일 때가 많아서 뺀다
    .filter((m): m is { it: TrendItem; g: NonNullable<ReturnType<typeof mainOf>>; p: number } => m.p !== null && !!m.g && m.g.n >= 6 && m.p > -75 && m.p < 300);

// ============================================================================ A. 증권 앱

function DraftA({ t, wiki }: { t: Trend; wiki: Wiki }) {
  const [tab, setTab] = useState<"gold" | "item">("gold");
  return (
    <div className="td td-a">
      <nav className="pill-row" role="tablist">
        {(["gold", "item"] as const).map((k) => (
          <button key={k} type="button" className={"pill" + (tab === k ? " pill-on" : "")} onClick={() => setTab(k)}>
            {k === "gold" ? "골드" : "물건"}
          </button>
        ))}
      </nav>
      {tab === "gold" ? (
        <>
          <AGold t={t} />
          <section className="td-card">
            <div className="td-cardhead">
              <b>많이 거래된 물건</b>
              <button type="button" className="td-more" onClick={() => setTab("item")}>전체 ›</button>
            </div>
            <StockList list={t.items.slice(0, 5).map((it) => ({ it, p: pctItem(it) }))} wiki={wiki} />
          </section>
        </>
      ) : (
        <AItems t={t} wiki={wiki} />
      )}
    </div>
  );
}

function AGold({ t }: { t: Trend }) {
  const [range, setRange] = useState<14 | 0>(14);
  const days = range ? t.gold.slice(-range) : t.gold;
  const sell = weekOf(t.gold, "sell", t.lastWeek);
  const buy = weekOf(t.gold, "buy", t.lastWeek);
  const p = pctOf(sell.before, sell.now);
  const pts = days.filter((d) => d.sell).map((d) => ({ label: md(d.date), v: d.sell!.med }));
  const subs = days.filter((d) => d.sell).map((d) => d.buy?.med ?? null);
  const posts = t.gold.slice(-7).reduce((s, d) => s + d.posts.sell + d.posts.buy, 0);
  return (
    <section className="td-card td-index">
      <div className="td-index-head">
        <span className="td-cap">골드 · 1만 원당</span>
        <span className="td-range">
          {([14, 0] as const).map((r) => (
            <button key={r} type="button" className={range === r ? "on" : ""} onClick={() => setRange(r)}>
              {r ? "2주" : "전체"}
            </button>
          ))}
        </span>
      </div>
      <div className="td-index-main">
        <b className="td-hero">
          <CountUp value={sell.now ?? 0} />
          <small>:1</small>
        </b>
        <Pct p={p} pill />
      </div>
      <LineChart key={range} pts={pts} sub={subs} fmt={(v) => `${v}:1`} dir={p ?? 0} h={130} />
      <div className="td-kpis">
        <span><small>팝니다</small><b>{sell.now ?? "–"}:1</b></span>
        <span><small>삽니다</small><b className="td-gold">{buy.now ?? "–"}:1</b></span>
        <span><small>7일 글</small><b><CountUp value={posts} /></b></span>
      </div>
    </section>
  );
}

type ASort = "vol" | "up" | "down";
function AItems({ t, wiki }: { t: Trend; wiki: Wiki }) {
  const [sort, setSort] = useState<ASort>("vol");
  const list = useMemo(() => {
    if (sort === "vol") return t.items.slice(0, 30).map((it) => ({ it, p: pctItem(it) }));
    const ms = movers(t.items);
    ms.sort((a, b) => (sort === "up" ? b.p - a.p : a.p - b.p));
    return ms.filter((m) => (sort === "up" ? m.p > 0 : m.p < 0)).slice(0, 30);
  }, [t.items, sort]);
  return (
    <section className="td-card">
      <div className="mk-sub td-seg">
        <div className="mk-side">
          {(
            [
              ["vol", "거래 많은"],
              ["up", "급등"],
              ["down", "급락"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={"sub-tab" + (sort === k ? " sub-tab-on" : "")} onClick={() => setSort(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <StockList key={sort} list={list} wiki={wiki} />
    </section>
  );
}

function StockList({ list, wiki }: { list: { it: TrendItem; p: number | null }[]; wiki: Wiki }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ol className="td-stocks">
      {list.map(({ it, p }, i) => (
        <li key={it.name} style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }} className={open === it.name ? "td-open" : ""}>
          <button type="button" className="td-stock" onClick={() => setOpen(open === it.name ? null : it.name)}>
            <span className="td-rank">{i + 1}</span>
            <ItemPic it={it} wiki={wiki} />
            <span className="td-name">
              <b>{it.name}</b>
              <small>글 {it.n}</small>
            </span>
            <MiniSpark days={it.days} dir={p ?? 0} />
            <span className="td-price">
              <b>{shortWon(it.med)}</b>
              <Pct p={p} />
            </span>
          </button>
          {open === it.name && <ADetail it={it} />}
        </li>
      ))}
    </ol>
  );
}

function ADetail({ it }: { it: TrendItem }) {
  const p = pctItem(it);
  const top = Math.max(...it.groups.map((g) => g.med), 0.01);
  return (
    <div className="td-detail">
      <LineChart pts={it.days.map(([d, v]) => ({ label: md(d), v }))} fmt={shortWon} dir={p ?? 0} h={110} />
      <div className="td-kpis">
        <span><small>중간값</small><b>{shortWon(it.med)}</b></span>
        <span><small>최저</small><b className="td-down">{shortWon(it.min)}</b></span>
        <span><small>최고</small><b className="td-up">{shortWon(it.max)}</b></span>
      </div>
      <ul className="td-ladder">
        {it.groups.slice(0, 6).map((g, i) => (
          <li key={g.label}>
            <em>{g.label || "노작"}</em>
            <span className="td-bar"><i style={{ width: `${(g.med / top) * 100}%`, animationDelay: `${i * 60}ms` }} /></span>
            <b>{shortWon(g.med)}</b>
            <Pct p={pctOf(g.before, g.recent)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MiniSpark({ days, dir }: { days: [string, number][]; dir: number }) {
  if (days.length < 2) return <span className="td-spark" />;
  const W = 48, H = 18;
  const vs = days.map((d) => d[1]);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const pts = days.map((d, i) => `${(1 + (i * (W - 2)) / (days.length - 1)).toFixed(1)},${(hi === lo ? H / 2 : 1 + ((hi - d[1]) * (H - 2)) / (hi - lo)).toFixed(1)}`).join(" ");
  return (
    <svg className={`td-spark td-line-${dir > 0 ? "up" : dir < 0 ? "down" : "flat"}`} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <polyline points={pts} pathLength={1} className="td-path" />
    </svg>
  );
}

// ============================================================================ B. 시세 전광판

function DraftB({ t, wiki }: { t: Trend; wiki: Wiki }) {
  const [pick, setPick] = useState<string | null>(null);
  const tape = useMemo(() => t.items.slice(0, 16).map((it) => ({ it, p: pctItem(it) })), [t.items]);
  const picked = t.items.find((it) => it.name === pick) ?? null;
  return (
    <div className="td td-b">
      <div className="td-tape" aria-hidden>
        <div className="td-tape-in">
          {[0, 1].map((k) => (
            <span key={k}>
              {tape.map(({ it, p }) => (
                <span key={it.name} className="td-tape-item">
                  {it.name} <b>{shortWon(it.med)}</b> <Pct p={p} />
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
      <BCandles t={t} />
      <section className="td-card">
        <div className="td-cardhead">
          <b>물건 히트맵</b>
          <small>칸 크기 = 글 수 · 색 = 7일 변화</small>
        </div>
        <Heatmap items={t.items.slice(0, 12)} pick={pick} onPick={setPick} />
        {picked && (
          <div className="td-heat-detail" key={picked.name}>
            <div className="td-stock td-stock-static">
              <ItemPic it={picked} wiki={wiki} />
              <span className="td-name">
                <b>{picked.name}</b>
                <small>글 {picked.n} · {picked.sellers}명</small>
              </span>
              <span className="td-price">
                <b>{shortWon(picked.med)}</b>
                <Pct p={pctItem(picked)} />
              </span>
            </div>
            <LineChart pts={picked.days.map(([d, v]) => ({ label: md(d), v }))} fmt={shortWon} dir={pctItem(picked) ?? 0} h={100} />
          </div>
        )}
      </section>
    </div>
  );
}

/** 날마다 캔들: 몸통 = 가운데 절반(q1~q3), 심지 = 최저~최고, 색 = 전날 중간값보다 오르면 빨강. 아래는 글 수 막대 */
function BCandles({ t }: { t: Trend }) {
  const [pick, setPick] = useState<number | null>(null);
  const days = t.gold.filter((d) => d.sell);
  const sell = weekOf(t.gold, "sell", t.lastWeek);
  const p = pctOf(sell.before, sell.now);
  const W = 340, H = 150, V = 30, T = 8;
  const lo = Math.min(...days.map((d) => d.sell!.min)) - 0.5;
  const hi = Math.max(...days.map((d) => d.sell!.max)) + 0.5;
  const cw = (W - 30) / days.length;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo); v <= hi; v++) if (v % 5 === 0) ticks.push(v);
  const x = (i: number) => 4 + cw * i + cw / 2;
  const y = (v: number) => T + ((hi - v) * (H - V - T - 6)) / (hi - lo);
  const vmax = Math.max(...days.map((d) => d.posts.sell + d.posts.buy), 1);
  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setPick(Math.max(0, Math.min(days.length - 1, Math.floor((px - 4) / cw))));
  };
  const d0 = pick === null ? days[days.length - 1] : days[pick];
  return (
    <section className="td-card td-term">
      <div className="td-term-head">
        <span className="td-sym">GOLD/KRW</span>
        <b className="td-hero td-hero-sm"><CountUp value={sell.now ?? 0} /><small>:1</small></b>
        <Pct p={p} pill />
      </div>
      <div className="td-term-sub">
        <span>{md(d0.date)}</span>
        <span>최저 <b>{d0.sell!.min}</b></span>
        <span>최고 <b>{d0.sell!.max}</b></span>
        <span>중간 <b>{d0.sell!.med}</b></span>
        <span>글 <b>{d0.posts.sell + d0.posts.buy}</b></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="td-candles" onPointerDown={onPointer} onPointerMove={(e) => e.buttons && onPointer(e)} role="img">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={0} x2={W - 22} y1={y(v)} y2={y(v)} className="td-grid" />
            <text x={W - 1} y={y(v) + 3} className="td-axis" textAnchor="end">{v}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const s = d.sell!;
          const prev = i ? days[i - 1].sell!.med : s.med;
          const up = s.med > prev ? "up" : s.med < prev ? "down" : "flat";
          const bw = Math.max(3, cw * 0.62);
          const vol = d.posts.sell + d.posts.buy;
          return (
            <g key={d.date} className={`td-c-${up}${pick === i ? " td-c-on" : ""}`} style={{ animationDelay: `${i * 30}ms` }}>
              <line x1={x(i)} x2={x(i)} y1={y(s.max)} y2={y(s.min)} className="td-wick" />
              <rect x={x(i) - bw / 2} y={y(s.q3)} width={bw} height={Math.max(2, y(s.q1) - y(s.q3))} className="td-body" />
              <rect x={x(i) - bw / 2} y={H - (vol / vmax) * V} width={bw} height={(vol / vmax) * V} className="td-vol" />
            </g>
          );
        })}
      </svg>
    </section>
  );
}

/** 간단한 트리맵: 무게 반씩 두 묶음으로 가르고 긴 쪽 방향으로 자른다 */
interface Rect { x: number; y: number; w: number; h: number }
function split<T>(xs: { w: number; v: T }[], r: Rect, out: { r: Rect; v: T }[]) {
  if (!xs.length) return;
  if (xs.length === 1) {
    out.push({ r, v: xs[0].v });
    return;
  }
  const total = xs.reduce((s, a) => s + a.w, 0);
  let acc = 0, k = 0;
  while (k < xs.length - 1 && acc + xs[k].w < total / 2) acc += xs[k++].w;
  if (k === 0) acc = xs[k++].w;
  const f = acc / total;
  if (r.w >= r.h) {
    split(xs.slice(0, k), { ...r, w: r.w * f }, out);
    split(xs.slice(k), { ...r, x: r.x + r.w * f, w: r.w * (1 - f) }, out);
  } else {
    split(xs.slice(0, k), { ...r, h: r.h * f }, out);
    split(xs.slice(k), { ...r, y: r.y + r.h * f, h: r.h * (1 - f) }, out);
  }
}
function Heatmap({ items, pick, onPick }: { items: TrendItem[]; pick: string | null; onPick: (n: string) => void }) {
  const tiles = useMemo(() => {
    const out: { r: Rect; v: TrendItem }[] = [];
    split(items.map((it) => ({ w: it.n, v: it })), { x: 0, y: 0, w: 100, h: 100 }, out);
    return out;
  }, [items]);
  return (
    <div className="td-heat">
      {tiles.map(({ r, v }, i) => {
        const p = pctItem(v) ?? 0;
        const a = Math.min(1, Math.abs(p) / 40);
        const bg = p > 0 ? `rgba(255, 92, 92, ${0.18 + a * 0.6})` : p < 0 ? `rgba(76, 141, 255, ${0.18 + a * 0.6})` : "rgba(169, 162, 207, 0.14)";
        const small = r.w * r.h < 450 || r.w < 18;
        const flat = r.h < 15;
        return (
          <button
            key={v.name}
            type="button"
            className={"td-tile" + (pick === v.name ? " on" : "") + (small ? " sm" : "") + (flat ? " flat" : "")}
            style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`, background: bg, animationDelay: `${i * 25}ms` }}
            onClick={() => onPick(v.name)}
          >
            <b>{v.name.replace(/\s*\(.*\)$/, "")}</b>
            <span>{shortWon(v.med)}</span>
            <Pct p={pctItem(v)} />
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================ C. 호가창

function DraftC({ t, wiki }: { t: Trend; wiki: Wiki }) {
  return (
    <div className="td td-c">
      <COrderBook t={t} />
      <CMovers t={t} wiki={wiki} />
      <CVolume t={t} wiki={wiki} />
    </div>
  );
}

/** 골드 호가창: 시세(N:1)마다 파는 사람 수(왼쪽 파랑)와 사는 사람 수(오른쪽 빨강) */
function COrderBook({ t }: { t: Trend }) {
  const rows = useMemo(() => {
    const m = new Map<number, { s: number; b: number }>();
    const add = (rate: number, k: "s" | "b") => {
      const r = Math.round(rate);
      if (r < 60 || r > 90) return;
      const e = m.get(r) ?? { s: 0, b: 0 };
      e[k]++;
      m.set(r, e);
    };
    t.goldPeople.sell.forEach((p) => add(p.med, "s"));
    t.goldPeople.buy.forEach((p) => add(p.med, "b"));
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [t.goldPeople]);
  const max = Math.max(...rows.map(([, e]) => Math.max(e.s, e.b)), 1);
  const sell = weekOf(t.gold, "sell", t.lastWeek);
  const p = pctOf(sell.before, sell.now);
  return (
    <section className="td-card">
      <div className="td-cardhead">
        <b>골드 호가</b>
        <span className="td-now">지금 <b>{sell.now ?? "–"}:1</b> <Pct p={p} /></span>
      </div>
      <div className="td-book">
        <div className="td-book-h"><span>파는 사람</span><span>N:1</span><span>사는 사람</span></div>
        {rows.map(([rate, e], i) => (
          <div key={rate} className={"td-book-row" + (rate === sell.now ? " td-book-now" : "")} style={{ animationDelay: `${i * 35}ms` }}>
            <span className="td-book-l">
              <small>{e.s || ""}</small>
              <i style={{ width: `calc((100% - 24px) * ${e.s / max})` }} />
            </span>
            <b>{rate}</b>
            <span className="td-book-r">
              <i style={{ width: `calc((100% - 24px) * ${e.b / max})` }} />
              <small>{e.b || ""}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CMovers({ t, wiki }: { t: Trend; wiki: Wiki }) {
  const ms = movers(t.items);
  const up = [...ms].filter((m) => m.p > 0).sort((a, b) => b.p - a.p).slice(0, 3);
  const down = [...ms].filter((m) => m.p < 0).sort((a, b) => a.p - b.p).slice(0, 3);
  const Cards = ({ xs, tone }: { xs: typeof ms; tone: string }): ReactNode => (
    <div className="td-movers">
      {xs.map(({ it, g, p }, i) => (
        <div key={it.name} className={`td-mover td-mover-${tone}`} style={{ animationDelay: `${i * 80}ms` }}>
          <ItemPic it={it} wiki={wiki} size={22} />
          <span className="td-mover-name">{it.name.replace(/\s*\(.*\)$/, "")}</span>
          <Pct p={p} big />
          <small>{g.label && <em>{g.label} </em>}{shortWon(g.before ?? 0)} → {shortWon(g.recent ?? 0)}</small>
        </div>
      ))}
    </div>
  );
  return (
    <section className="td-card">
      <div className="td-cardhead"><b>이번 주 급등</b></div>
      <Cards xs={up} tone="up" />
      <div className="td-cardhead"><b>이번 주 급락</b></div>
      <Cards xs={down} tone="down" />
    </section>
  );
}

function CVolume({ t, wiki }: { t: Trend; wiki: Wiki }) {
  const [open, setOpen] = useState<string | null>(null);
  const list = t.items.slice(0, 20);
  const vmax = Math.max(...list.map((it) => it.n), 1);
  return (
    <section className="td-card">
      <div className="td-cardhead"><b>거래량 순위</b><small>막대 = 글 수</small></div>
      <ol className="td-vols">
        {list.map((it, i) => {
          const p = pctItem(it);
          return (
            <li key={it.name} className={open === it.name ? "td-open" : ""}>
              <button type="button" className="td-volrow" onClick={() => setOpen(open === it.name ? null : it.name)}>
                <i className="td-volbar" style={{ width: `${(it.n / vmax) * 100}%`, animationDelay: `${i * 40}ms` }} />
                <span className="td-rank">{i + 1}</span>
                <ItemPic it={it} wiki={wiki} size={20} />
                <span className="td-name"><b>{it.name}</b></span>
                <span className="td-num">{shortWon(it.med)}</span>
                <span className="td-num"><Pct p={p} /></span>
              </button>
              {open === it.name && (
                <div className="td-detail">
                  <LineChart pts={it.days.map(([d, v]) => ({ label: md(d), v }))} fmt={shortWon} dir={p ?? 0} h={100} />
                  <div className="td-groupline">
                    {it.groups.slice(0, 6).map((g) => (
                      <span key={g.label}><em>{g.label || "노작"}</em> {shortWon(g.med)}</span>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ============================================================================

export function draftOf(): Draft | null {
  const q = window.location.hash.split("?")[1] ?? "";
  const d = new URLSearchParams(q).get("draft");
  return d === "a" || d === "b" || d === "c" ? d : null;
}

export type Draft = "a" | "b" | "c";
export function TrendDraft({ t, wiki, draft, onDraft }: { t: Trend; wiki: Wiki; draft: Draft; onDraft: (d: Draft) => void }) {
  return (
    <div>
      <div className="td-switch">
        초안
        {(["a", "b", "c"] as const).map((d) => (
          <button key={d} type="button" className={draft === d ? "on" : ""} onClick={() => onDraft(d)}>
            {d === "a" ? "A 증권 앱" : d === "b" ? "B 전광판" : "C 호가창"}
          </button>
        ))}
      </div>
      {draft === "a" && <DraftA t={t} wiki={wiki} />}
      {draft === "b" && <DraftB t={t} wiki={wiki} />}
      {draft === "c" && <DraftC t={t} wiki={wiki} />}
    </div>
  );
}
