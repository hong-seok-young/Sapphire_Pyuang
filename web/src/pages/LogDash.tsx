// 사용 기록 대시보드 (제작자 2026-11-13 '사용기록 ui 싹 개편, 누가 웹과 챗봇 api 등 사용량이 많은가 대시보드, 차트와 그래픽 애니메이션 잔뜩',
// '로그인 횟수 등등 종합적으로 고려해서 잘 쓰는 사람과 안 쓰는 사람 정도로 보이게'). 서버 server/actDash.ts.
// 움직임은 보는 동안·누를 때만 (CLAUDE.md '움직임은 보고 있거나 눌렀을 때만'): 지금 접속 중 레이더·점, 그림 끝 파문, 1위 줄 빛, 바뀐 값 톡, 막대는 기준을 바꿀 때만 미끄러진다.
// 끝없이 도는 것은 transform·opacity 만 (logdash.css). 색은 dataviz 검사기로 판 바탕 #262150 에서 통과한 다섯 색 (--ld-1 ~ --ld-5)
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { errorText } from "../auth";
import {
  AI_NAME,
  TIERS,
  TIER_NAME,
  VIA_NAME,
  WEEK,
  actionText,
  dayMD,
  dayWeek,
  fetchDash,
  fetchLive,
  fetchPerson,
  pageName,
  secItem,
  tierOf,
} from "../activity";
import type { Dash, DashPerson, LiveNow, Period, PersonDash, Tier, Via } from "../activity";
import { ago } from "../market";
import { peekMemo, putMemo } from "../memo";
import { emojiPic } from "../emojiIcons";
import { Nick } from "../kakao";
import type { Wiki } from "../types";
import { Loading } from "../ui";
import "./logdash.css";

// ---------- 글자 ----------
export const num = (n: number) => Math.round(n).toLocaleString();
/** 5분 칸 수 -> '3시간 20분' */
export function minText(m5: number): string {
  const m = m5 * 5;
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}
/** 짧게: '12시간' / '45분' */
const minShort = (m5: number) => (m5 * 5 < 60 ? `${m5 * 5}분` : `${Math.round((m5 * 5) / 6) / 10}시간`);
/** 토큰: '8,400' · '12.5만' · '1.2억' */
export function tokText(n: number): string {
  if (n < 10_000) return num(n);
  if (n < 100_000_000) return `${(n / 10_000).toFixed(n < 100_000 ? 1 : 0)}만`;
  return `${(n / 100_000_000).toFixed(1)}억`;
}
/** 달러: '$0.42' · '$12.30' · '$216.5' (100 넘으면 소수 첫째까지) */
export const usdText = (n: number) => (n >= 100 ? `$${n.toFixed(1)}` : `$${n.toFixed(2)}`);
/** '3시간 전' · '40분 전' */
const agoText = (ms: number) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))}분 전` : `${Math.round(ms / 3_600_000)}시간 전`);
/** API 월 한도 (제작자 2026-11-13 '맥시멈 340') */
const AI_MONTH_LIMIT = 340;
export function lastText(last: number | null, today: number): string {
  if (last === null) return "들어온 적 없음";
  const d = today - last;
  return d <= 0 ? "오늘" : d === 1 ? "어제" : `${d}일째 안 옴`;
}

/** 값이 바뀌면 톡 튀게 (처음 그릴 때는 그대로) */
export function Pop({ v, children }: { v: unknown; children: ReactNode }) {
  const last = useRef(v);
  const n = useRef(0);
  if (last.current !== v) {
    last.current = v;
    n.current += 1;
  }
  return (
    <span key={n.current} className={n.current ? "ld-pop" : undefined}>
      {children}
    </span>
  );
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(300);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** 보이는 동안만 ms 마다 */
function useVisibleTick(ms: number, fn: () => void) {
  const f = useRef(fn);
  f.current = fn;
  useEffect(() => {
    const t = window.setInterval(() => document.visibilityState === "visible" && f.current(), ms);
    const v = () => document.visibilityState === "visible" && f.current();
    document.addEventListener("visibilitychange", v);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", v);
    };
  }, [ms]);
}

// ---------- 자료 받기 ----------
/** 대시보드: 지난 날 요약이 남았으면(partial) 몇 번 더 부른다. 받아 둔 것은 다시 열 때 바로 */
export function useDash(period: Period) {
  const key = `log.dash.${period}`;
  const [dash, setDash] = useState<Dash | undefined>(() => peekMemo<Dash>(key));
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    let tries = 0;
    setDash(peekMemo<Dash>(key));
    setError("");
    const load = () =>
      fetchDash(period).then(
        (d) => {
          if (!alive) return;
          putMemo(key, d);
          setDash(d);
          if (d.partial && tries++ < 8) window.setTimeout(load, 300);
        },
        (x) => alive && setError(errorText(x)),
      );
    load();
    return () => {
      alive = false;
    };
  }, [period, key, tick]);
  // 보는 동안 2분마다 새로 (오늘 숫자)
  useVisibleTick(120_000, () => setTick((n) => n + 1));
  return { dash, error, reload: () => setTick((n) => n + 1) };
}

export function useLive() {
  const [live, setLive] = useState<LiveNow | undefined>(() => peekMemo<LiveNow>("log.live"));
  const load = () =>
    fetchLive().then(
      (d) => {
        putMemo("log.live", d);
        setLive(d);
      },
      () => undefined,
    );
  useEffect(() => {
    load();
  }, []);
  useVisibleTick(20_000, load);
  return live;
}

export function usePerson(user: string | null, period: Period) {
  const key = user ? `log.person.${user}.${period}` : undefined;
  const [data, setData] = useState<PersonDash | undefined>(() => peekMemo<PersonDash>(key));
  const [error, setError] = useState("");
  useEffect(() => {
    if (!user) return;
    let alive = true;
    setData(peekMemo<PersonDash>(key));
    setError("");
    fetchPerson(user, period).then(
      (d) => {
        if (!alive) return;
        putMemo(key, d);
        setData(d);
      },
      (x) => alive && setError(errorText(x)),
    );
    return () => {
      alive = false;
    };
  }, [user, period, key]);
  return { data, error };
}

// ---------- 지금 접속 중 ----------
export function LivePanel({ live, wiki, onPick }: { live?: LiveNow; wiki: Wiki; onPick: (id: string) => void }) {
  const people = live?.people ?? [];
  const what = (p: LiveNow["people"][number]) =>
    p.kind === "visit" ? "막 들어옴" : p.kind === "view" ? pageName(p.what, wiki, p.detail) : actionText(p.what, p.detail, p.at);
  return (
    <section className="panel ld-live">
      <div className="ld-live-head">
        <span className={"ld-radar" + (people.length ? " ld-radar-on" : "")} aria-hidden>
          <i />
          {people.slice(0, 5).map((p, i) => (
            <b key={p.id} style={{ "--a": `${(i * 137) % 360}deg`, "--r": `${30 + ((i * 23) % 55)}%` } as React.CSSProperties} />
          ))}
        </span>
        <div className="ld-live-num">
          <b>
            <Pop v={people.length}>{people.length}</Pop>
          </b>
          <span>명 지금 접속 중</span>
          <small>10분 안 · 20초마다</small>
        </div>
      </div>
      {live && <Heartbeat perMin={live.perMin} />}
      {people.length > 0 ? (
        <ul className="ld-live-people">
          {people.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onPick(p.id)}>
                <i className="ld-dot" aria-hidden />
                <b>
                  <Nick name={p.id} />
                  {p.char !== p.id && <small> · {p.char}</small>}
                </b>
                <span>{what(p)}</span>
                <small>
                  {ago(p.at, live?.now)}
                  {p.via ? ` · ${VIA_NAME[p.via as Via] ?? p.via}` : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ld-quiet">{live ? "지금은 조용해요" : "보는 중…"}</p>
      )}
    </section>
  );
}

/** 지난 60분 분마다 활동 (오른쪽 끝이 지금, 끝 점에서 파문) */
function Heartbeat({ perMin }: { perMin: number[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const h = 34;
  const max = Math.max(1, ...perMin);
  const step = w / (perMin.length - 1);
  const pts = perMin.map((n, i) => [i * step, h - 3 - (n / max) * (h - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const [ex, ey] = pts[pts.length - 1];
  return (
    <div className="ld-beat" ref={ref} role="img" aria-label={`지난 60분 활동 ${num(perMin.reduce((a, b) => a + b, 0))}`}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <path d={`${line}L${w},${h}L0,${h}Z`} className="ld-beat-fill" />
        <path d={line} className="ld-beat-line" />
        <circle cx={ex} cy={ey} r="3" className="ld-beat-end" />
        <circle cx={ex} cy={ey} r="3" className="ld-ping" />
      </svg>
      <small>
        <span>60분 전</span>
        <span>지금</span>
      </small>
    </div>
  );
}

// ---------- 핵심 숫자 ----------
type MetricKey = "users" | "v" | "w" | "a" | "m" | "q" | "tok";
const METRICS: { key: MetricKey; name: string; fmt: (n: number) => string }[] = [
  { key: "users", name: "들어온 사람", fmt: (n) => `${num(n)}명` },
  { key: "v", name: "로그인", fmt: (n) => `${num(n)}번` },
  { key: "w", name: "본 화면", fmt: num },
  { key: "a", name: "한 일", fmt: num },
  { key: "m", name: "시간", fmt: minShort },
  { key: "q", name: "챗봇 질문", fmt: num },
  { key: "tok", name: "AI 토큰", fmt: tokText },
];

export function KpiGrid({ dash }: { dash: Dash }) {
  const { daily, period, people } = dash;
  const cur = daily.slice(-period);
  const prev = daily.slice(-period * 2, -period);
  const sum = (rows: typeof daily, k: MetricKey) => rows.reduce((t, r) => t + r[k], 0);
  const users = people.filter((p) => p.days > 0).length;
  const prevUsers = people.filter((p) => p.prev.days > 0).length;
  return (
    <div className="ld-kpis">
      {METRICS.map((m) => {
        const value = m.key === "users" ? users : sum(cur, m.key);
        const before = m.key === "users" ? prevUsers : sum(prev, m.key);
        const spark = daily.slice(-14).map((r) => r[m.key]);
        const diff = before ? Math.round(((value - before) / before) * 100) : null;
        return (
          <div key={m.key} className={"ld-kpi ld-kpi-" + m.key}>
            <span className="ld-kpi-name">{m.name}</span>
            <b className="ld-kpi-val">
              <Pop v={`${period}:${value}`}>{m.fmt(value)}</Pop>
            </b>
            <small className="ld-kpi-cmp">
              {period === 1 ? (
                `어제 ${m.fmt(before)}`
              ) : diff === null ? (
                "지난 기간 없음"
              ) : (
                <>
                  <em className={diff > 0 ? "ld-up" : diff < 0 ? "ld-down" : ""}>{diff > 0 ? `▲${diff}%` : diff < 0 ? `▼${-diff}%` : "그대로"}</em> 지난 {period}일
                </>
              )}
            </small>
            <MiniBars values={spark} />
          </div>
        );
      })}
    </div>
  );
}

/** 작은 막대 (14일, 오른쪽 끝이 오늘) */
export function MiniBars({ values, className = "" }: { values: number[]; className?: string }) {
  const max = Math.max(1, ...values);
  return (
    <span className={"ld-mini " + className} aria-hidden>
      {values.map((v, i) => (
        <i key={i} style={{ height: `${Math.max(v ? 8 : 0, (v / max) * 100)}%` }} className={i === values.length - 1 ? "ld-mini-last" : undefined} />
      ))}
    </span>
  );
}

// ---------- 추이 그림 ----------
const niceMax = (v: number) => {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return v;
};

export function TrendPanel({ dash }: { dash: Dash }) {
  const [metric, setMetric] = useState<MetricKey>("users");
  const [pick, setPick] = useState<number | null>(null);
  const hourly = dash.period === 1;
  const days = dash.daily.slice(-30);
  const m = METRICS.find((x) => x.key === metric)!;
  const values = hourly ? dash.hourly.today : days.map((r) => r[metric]);
  const avg = hourly ? dash.hourly.avg : null;
  const nowHour = new Date(dash.now + 9 * 3_600_000).getUTCHours();
  const n = values.length;
  const sel = pick !== null && pick < n ? pick : hourly ? nowHour : n - 1;
  const inPeriod = (i: number) => hourly || i >= n - dash.period;
  const readout = hourly ? (
    <>
      <b>{sel}시</b> 오늘 활동 {num(values[sel])} · 지난 7일 평균 {num(avg![sel])}
    </>
  ) : (
    <>
      <b>
        {dayMD(days[sel].d)}({dayWeek(days[sel].d)})
      </b>{" "}
      사람 {days[sel].users} · 로그인 {num(days[sel].v)} · 화면 {num(days[sel].w)} · 한 일 {num(days[sel].a)} · {minShort(days[sel].m)} · 챗봇 {days[sel].q}
      {days[sel].tok > 0 && ` · 토큰 ${tokText(days[sel].tok)}`}
    </>
  );
  return (
    <section className="panel ld-trend">
      <h2 className="panel-title">{hourly ? "오늘 시간대별 활동" : "날마다 (30일)"}</h2>
      {!hourly && (
        <nav className="sub-tabs ld-metrics">
          {METRICS.map((x) => (
            <button key={x.key} type="button" className={"sub-tab" + (metric === x.key ? " sub-tab-on" : "")} onClick={() => setMetric(x.key)}>
              {x.name.replace("들어온 ", "").replace("본 ", "").replace("사용 ", "").replace("챗봇 ", "").replace("AI ", "")}
            </button>
          ))}
        </nav>
      )}
      <p className="ld-readout">
        <Pop v={`${metric}:${sel}`}>{readout}</Pop>
      </p>
      <BarChart values={values} avg={avg} sel={sel} onPick={setPick} dim={(i) => !inPeriod(i)} fmt={hourly ? num : m.fmt} labels={hourly ? (i) => (i % 6 === 0 ? `${i}시` : "") : (i) => (i % 7 === (n - 1) % 7 ? dayMD(days[i].d) : "")} now={hourly ? nowHour : n - 1} />
      {hourly && (
        <div className="ld-legend">
          <span>
            <i className="ld-sw ld-sw-1" />
            오늘
          </span>
          <span>
            <i className="ld-sw ld-sw-line" />
            지난 7일 평균
          </span>
        </div>
      )}
    </section>
  );
}

/** 막대 그림 (하나의 값). 막대를 누르면 그때 값. 지금 막대 위에서 파문 */
export function BarChart({
  values,
  avg,
  sel,
  onPick,
  dim,
  fmt,
  labels,
  now,
  height = 140,
  stack,
}: {
  values: number[];
  avg?: number[] | null;
  sel: number;
  onPick: (i: number) => void;
  dim?: (i: number) => boolean;
  fmt: (n: number) => string;
  labels: (i: number) => string;
  now: number;
  height?: number;
  /** 막대를 둘로 나눠 칠한다 (아래 값, 예: 한 일) */
  stack?: number[];
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const pl = 34;
  const pr = 4;
  const pt = 12;
  const pb = 18;
  const top = niceMax(Math.max(1, ...values, ...(avg ?? [])));
  const ih = height - pt - pb;
  const bw = (w - pl - pr) / values.length;
  const y = (v: number) => pt + ih - (v / top) * ih;
  const ticks = [0, top / 2, top];
  const avgPath = avg?.map((v, i) => `${i ? "L" : "M"}${(pl + i * bw + bw / 2).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <div className="ld-chart" ref={ref}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label="막대 그림">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pl} x2={w - pr} y1={y(t)} y2={y(t)} className="ld-grid" />
            <text x={pl - 4} y={y(t) + 3} className="ld-axis" textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const x = pl + i * bw + 1;
          const bh = Math.max(v ? 2 : 0, (v / top) * ih);
          const sh = stack ? Math.min(bh, (stack[i] / top) * ih) : 0;
          return (
            <g key={i} className={"ld-bar" + (i === sel ? " ld-bar-on" : "") + (dim?.(i) ? " ld-bar-dim" : "")}>
              <rect x={x} y={pt} width={Math.max(1, bw - 2)} height={ih} className="ld-bar-hit" onClick={() => onPick(i)} />
              <rect x={x} y={pt + ih - bh} width={Math.max(1, bw - 2)} height={bh} rx={Math.min(2, bw / 4)} className="ld-bar-fill" style={{ transformOrigin: `0 ${pt + ih}px` }} />
              {sh > 0 && <rect x={x} y={pt + ih - sh} width={Math.max(1, bw - 2)} height={sh} className="ld-bar-stack" />}
              {labels(i) && (
                <text x={x + (bw - 2) / 2} y={height - 4} className="ld-axis" textAnchor="middle">
                  {labels(i)}
                </text>
              )}
            </g>
          );
        })}
        {avgPath && <path d={avgPath} className="ld-avg" />}
        {now >= 0 && now < values.length && (
          <g className="ld-now" transform={`translate(${pl + now * bw + bw / 2 - 1} ${y(values[now]) - 4})`}>
            <circle r="2.5" className="ld-now-dot" />
            <circle r="2.5" className="ld-ping" />
          </g>
        )}
      </svg>
    </div>
  );
}

// ---------- 잘 쓰는 사람 · 안 쓰는 사람 ----------
export function ScoreRing({ score, size = 34, tier }: { score: number; size?: number; tier?: Tier }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const t = tier ?? tierOf(score);
  return (
    <span className={"ld-ring ld-t-" + t} style={{ width: size, height: size }} aria-label={`점수 ${score}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ld-ring-bg" />
        <circle cx={size / 2} cy={size / 2} r={r} className="ld-ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, score) / 100)} />
      </svg>
      <b>
        <Pop v={score}>{score}</Pop>
      </b>
    </span>
  );
}

const SHOWN_TIER = 8;

export function TierPanel({ dash, onPick }: { dash: Dash; onPick: (id: string) => void }) {
  const [open, setOpen] = useState<Tier | null>(null);
  const groups = useMemo(() => {
    const g: Record<Tier, DashPerson[]> = { core: [], active: [], light: [], idle: [] };
    for (const p of dash.people) g[tierOf(p.score)].push(p);
    for (const t of Object.keys(g) as Tier[]) g[t].sort((a, b) => b.score - a.score || (b.last ?? -1) - (a.last ?? -1));
    g.idle.sort((a, b) => (b.last ?? -1) - (a.last ?? -1));
    return g;
  }, [dash]);
  const total = dash.people.length || 1;
  return (
    <section className="panel ld-tier">
      <h2 className="panel-title">잘 쓰는 사람 · 안 쓰는 사람</h2>
      <div className="ld-tier-bar" role="img" aria-label={TIERS.map((t) => `${t.name} ${groups[t.key].length}명`).join(", ")}>
        {TIERS.map((t) =>
          groups[t.key].length ? (
            <span key={t.key} className={"ld-t-" + t.key} style={{ flexGrow: groups[t.key].length }}>
              {(groups[t.key].length / total) * 100 >= 9 ? groups[t.key].length : ""}
            </span>
          ) : null,
        )}
      </div>
      <p className="ld-score-why">
        점수 = 들어온 날 40 · 사용 시간 25 · 로그인 15 · 한 일 10 · 챗봇 10 ({dash.period === 1 ? "오늘" : `${dash.period}일`} 기준)
      </p>
      <div className="ld-tiers">
        {TIERS.map((t) => {
          const list = groups[t.key];
          const all = open === t.key;
          return (
            <div key={t.key} className={"ld-tcol ld-t-" + t.key}>
              <h3>
                <i className="ld-tdot" />
                {t.name}
                <b>{list.length}명</b>
                <small>{t.key === "idle" ? `${t.min + 8}점 아래` : `${t.min}점 이상`}</small>
              </h3>
              <ul>
                {(all ? list : list.slice(0, SHOWN_TIER)).map((p) => {
                  const pt = tierOf(p.prevScore);
                  const move = TIERS.findIndex((x) => x.key === pt) - TIERS.findIndex((x) => x.key === t.key);
                  return (
                    <li key={p.id}>
                      <button type="button" onClick={() => onPick(p.id)}>
                        <span className="ld-tname">
                          <Nick name={p.id} />
                          {dash.period > 1 && move > 0 && <em className="ld-up">▲</em>}
                          {dash.period > 1 && move < 0 && <em className="ld-down">▼</em>}
                        </span>
                        {t.key === "idle" ? (
                          <small className={p.last === null || dash.today - p.last >= 7 ? "ld-cold" : ""}>{lastText(p.last, dash.today)}</small>
                        ) : (
                          <small>
                            {p.days}일 · 로그인 {p.v} · {minShort(p.m)}
                          </small>
                        )}
                        <span className="ld-tscore" style={{ "--s": `${p.score}%` } as React.CSSProperties}>
                          <i />
                          <b>{p.score}</b>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {list.length > SHOWN_TIER && (
                <button type="button" className="ld-more" onClick={() => setOpen(all ? null : t.key)}>
                  {all ? "접기" : `${list.length - SHOWN_TIER}명 더`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------- 누가 많이 쓰나 ----------
type LeadKey = "score" | "web" | "m" | "v" | "q" | "tok";
const LEADS: { key: LeadKey; name: string; get: (p: DashPerson) => number; prev?: (p: DashPerson) => number; fmt: (p: DashPerson) => string }[] = [
  { key: "score", name: "종합", get: (p) => p.score, prev: (p) => p.prevScore, fmt: (p) => `${p.score}점` },
  { key: "web", name: "활동", get: (p) => p.w + p.a, prev: (p) => p.prev.w + p.prev.a, fmt: (p) => num(p.w + p.a) },
  { key: "m", name: "시간", get: (p) => p.m, prev: (p) => p.prev.m, fmt: (p) => minText(p.m) },
  { key: "v", name: "로그인", get: (p) => p.v, prev: (p) => p.prev.v, fmt: (p) => `${num(p.v)}번` },
  { key: "q", name: "챗봇", get: (p) => p.q, prev: (p) => p.prev.q, fmt: (p) => `${num(p.q)}번` },
  { key: "tok", name: "토큰", get: (p) => p.tok, fmt: (p) => tokText(p.tok) },
];

export function LeadPanel({ dash, onPick }: { dash: Dash; onPick: (id: string) => void }) {
  const [key, setKey] = useState<LeadKey>("score");
  const [all, setAll] = useState(false);
  const lead = LEADS.find((l) => l.key === key)!;
  const rows = dash.people.filter((p) => lead.get(p) > 0).sort((a, b) => lead.get(b) - lead.get(a));
  const prevRank = new Map(
    lead.prev ? dash.people.filter((p) => lead.prev!(p) > 0).sort((a, b) => lead.prev!(b) - lead.prev!(a)).map((p, i) => [p.id, i]) : [],
  );
  const max = Math.max(1, ...rows.map(lead.get));
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <section className="panel ld-lead">
      <h2 className="panel-title">누가 많이 쓰나</h2>
      <nav className="sub-tabs ld-lead-keys">
        {LEADS.map((l) => (
          <button key={l.key} type="button" className={"sub-tab" + (key === l.key ? " sub-tab-on" : "")} onClick={() => setKey(l.key)}>
            {l.name}
          </button>
        ))}
      </nav>
      {key === "web" && (
        <div className="ld-legend">
          <span>
            <i className="ld-sw ld-sw-1" />
            본 화면
          </span>
          <span>
            <i className="ld-sw ld-sw-2" />
            한 일
          </span>
        </div>
      )}
      {key === "tok" && dash.aiSince !== null && <p className="ld-score-why">{dayMD(dash.aiSince)}부터 셈 · 입력+출력</p>}
      {rows.length === 0 ? (
        <p className="ld-quiet">{key === "tok" ? "아직 쌓인 토큰이 없어요" : "아직 없어요"}</p>
      ) : (
        <ol className="ld-board">
          {shown.map((p, i) => {
            const was = prevRank.get(p.id);
            const move = was === undefined ? null : was - i;
            const v = lead.get(p);
            return (
              <li key={p.id} className={"ld-row" + (i === 0 ? " ld-row-1" : i < 3 ? " ld-row-top" : "")}>
                <button type="button" onClick={() => onPick(p.id)}>
                  <span className={"ld-rank ld-rank-" + (i + 1)}>{i === 0 ? <i className="ld-crown" aria-hidden /> : null}{i + 1}</span>
                  <span className="ld-row-name">
                    <Nick name={p.id} />
                    {lead.prev && dash.period > 1 && (
                      <em className={move === null ? "ld-new" : move > 0 ? "ld-up" : move < 0 ? "ld-down" : "ld-same"}>
                        {move === null ? "NEW" : move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : "–"}
                      </em>
                    )}
                  </span>
                  <span className="ld-row-bar">
                    {key === "web" ? (
                      <>
                        <i className="ld-seg-1" style={{ width: `${(p.w / max) * 100}%` }} />
                        <i className="ld-seg-2" style={{ width: `${(p.a / max) * 100}%` }} />
                      </>
                    ) : (
                      <i className={key === "q" ? "ld-seg-4" : key === "tok" ? "ld-seg-5" : key === "v" ? "ld-seg-3" : "ld-seg-1"} style={{ width: `${(v / max) * 100}%` }} />
                    )}
                  </span>
                  <b className="ld-row-val">
                    <Pop v={`${key}:${v}`}>{lead.fmt(p)}</Pop>
                  </b>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {rows.length > 10 && (
        <button type="button" className="ld-more" onClick={() => setAll(!all)}>
          {all ? "접기" : `${rows.length - 10}명 더`}
        </button>
      )}
    </section>
  );
}

// ---------- 요일 x 시간 ----------
/** 월요일부터 (한국 사람은 월~일로 본다) */
const ROW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const heatStep = (v: number, max: number) => (v <= 0 ? 0 : Math.min(5, 1 + Math.floor((v / max) * 5)));

export function HeatPanel({ heat, users, days, now, title = "언제 붐비나" }: { heat: number[][]; users?: number[][]; days: number; now: number; title?: string }) {
  const [pick, setPick] = useState<[number, number] | null>(null);
  const max = Math.max(1, ...heat.flat());
  const k = new Date(now + 9 * 3_600_000);
  const nowW = k.getUTCDay();
  const nowH = k.getUTCHours();
  let peak: [number, number] = [0, 0];
  for (const w of ROW_ORDER) for (let h = 0; h < 24; h++) if (heat[w][h] > heat[peak[0]][peak[1]]) peak = [w, h];
  const perDay = Math.max(1, Math.round(days / 7));
  const show = pick ?? peak;
  return (
    <section className="panel ld-heat">
      <h2 className="panel-title">{title}</h2>
      <p className="ld-readout">
        <Pop v={show.join(":")}>
          <b>
            {WEEK[show[0]]} {show[1]}시
          </b>{" "}
          {pick ? "" : "가장 붐빔 · "}활동 {num(heat[show[0]][show[1]])}
          {users && ` · 하루 평균 ${Math.round((users[show[0]][show[1]] / perDay) * 10) / 10}명`}
        </Pop>
      </p>
      <div className="ld-heat-grid" role="img" aria-label="요일과 시간마다 활동">
        {ROW_ORDER.map((w) => (
          <div key={w} className="ld-heat-row">
            <span className="ld-heat-day">{WEEK[w]}</span>
            {heat[w].map((v, h) => (
              <button
                key={h}
                type="button"
                aria-label={`${WEEK[w]} ${h}시 ${v}`}
                className={
                  "ld-cell ld-h" +
                  heatStep(v, max) +
                  (w === nowW && h === nowH ? " ld-cell-now" : "") +
                  (pick && pick[0] === w && pick[1] === h ? " ld-cell-on" : "") +
                  (!pick && w === peak[0] && h === peak[1] && v > 0 ? " ld-cell-peak" : "")
                }
                onClick={() => setPick(pick && pick[0] === w && pick[1] === h ? null : [w, h])}
              />
            ))}
          </div>
        ))}
        <div className="ld-heat-row ld-heat-hours">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <small key={h}>{h % 6 === 0 ? h : ""}</small>
          ))}
        </div>
      </div>
      <div className="ld-heat-scale" aria-hidden>
        <small>적음</small>
        {[1, 2, 3, 4, 5].map((s) => (
          <i key={s} className={"ld-h" + s} />
        ))}
        <small>많음</small>
      </div>
    </section>
  );
}

// ---------- 메뉴 ----------
function SecIcon({ icon, pic }: { icon: string; pic?: string }) {
  const src = pic ?? emojiPic(icon);
  return src ? <img className="ld-sec-pic" src={src} alt="" /> : <span className="ld-sec-emo">{icon}</span>;
}

export function MenuPanel({ secs, title = "많이 쓴 메뉴" }: { secs: { s: string; n: number; us?: number }[]; title?: string }) {
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    const m = new Map<string, { key: string; title: string; icon: string; pic?: string; w: number; a: number; us: number }>();
    for (const r of secs) {
      const it = secItem(r.s);
      const o = m.get(it.key) ?? (m.set(it.key, { key: it.key, title: it.title, icon: it.icon, pic: it.item?.iconPic, w: 0, a: 0, us: 0 }), m.get(it.key)!);
      if (r.s.startsWith("act:")) o.a += r.n;
      else o.w += r.n;
      o.us = Math.max(o.us, r.us ?? 0);
    }
    return [...m.values()].sort((a, b) => b.w + b.a - (a.w + a.a));
  }, [secs]);
  const max = Math.max(1, ...rows.map((r) => r.w + r.a));
  const total = rows.reduce((t, r) => t + r.w + r.a, 0) || 1;
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <section className="panel ld-menu">
      <h2 className="panel-title">{title}</h2>
      <div className="ld-legend">
        <span>
          <i className="ld-sw ld-sw-1" />본 화면
        </span>
        <span>
          <i className="ld-sw ld-sw-2" />한 일
        </span>
      </div>
      <ol className="ld-board">
        {shown.map((r) => (
          <li key={r.key} className="ld-row">
            <span className="ld-row-in">
              <SecIcon icon={r.icon} pic={r.pic} />
              <span className="ld-row-name">{r.title}</span>
              <span className="ld-row-bar">
                <i className="ld-seg-1" style={{ width: `${(r.w / max) * 100}%` }} />
                <i className="ld-seg-2" style={{ width: `${(r.a / max) * 100}%` }} />
              </span>
              <b className="ld-row-val">
                {num(r.w + r.a)}
                <small> {Math.round(((r.w + r.a) / total) * 100)}%</small>
              </b>
            </span>
          </li>
        ))}
      </ol>
      {rows.length > 8 && (
        <button type="button" className="ld-more" onClick={() => setAll(!all)}>
          {all ? "접기" : `${rows.length - 8}개 더`}
        </button>
      )}
    </section>
  );
}

// ---------- 어디서 ----------
const VIA_ORDER: Via[] = ["android", "ios", "pc", "app", "float"];
export function ViaPanel({ vias }: { vias: Dash["vias"] }) {
  const total = vias.reduce((t, v) => t + v.n, 0) || 1;
  const rows = VIA_ORDER.map((v, i) => ({ via: v, slot: i + 1, n: vias.find((x) => x.via === v)?.n ?? 0 })).filter((r) => r.n > 0);
  const etc = vias.filter((x) => !VIA_ORDER.includes(x.via as Via)).reduce((t, x) => t + x.n, 0);
  return (
    <section className="panel ld-via">
      <h2 className="panel-title">어디서 쓰나</h2>
      <div className="ld-via-bar" role="img" aria-label={rows.map((r) => `${VIA_NAME[r.via]} ${Math.round((r.n / total) * 100)}%`).join(", ")}>
        {rows.map((r) => (
          <span key={r.via} className={"ld-seg-" + r.slot} style={{ flexGrow: r.n }} />
        ))}
        {etc > 0 && <span className="ld-seg-etc" style={{ flexGrow: etc }} />}
      </div>
      <ul className="ld-via-list">
        {rows.map((r) => (
          <li key={r.via}>
            <i className={"ld-sw ld-sw-" + r.slot} />
            {VIA_NAME[r.via]}
            <b>{Math.round((r.n / total) * 100)}%</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- 챗봇 · AI ----------
export function AiPanel({ dash }: { dash: Dash }) {
  const [pick, setPick] = useState<number | null>(null);
  const days = dash.daily.slice(-30);
  const cur = dash.daily.slice(-dash.period);
  const q = cur.reduce((t, r) => t + r.q, 0);
  const askers = dash.people.filter((p) => p.q > 0).length;
  const tok = dash.ai.reduce((t, k) => t + k.input + k.output + k.cache, 0);
  const out = dash.ai.reduce((t, k) => t + k.output, 0);
  const web = dash.ai.reduce((t, k) => t + k.web, 0);
  const usd = dash.ai.reduce((t, k) => t + (k.usd ?? 0), 0);
  const month = dash.aiMonth;
  const n = days.length;
  const sel = pick ?? n - 1;
  const maxCalls = Math.max(1, ...dash.ai.map((k) => k.calls));
  return (
    <section className="panel ld-ai">
      <h2 className="panel-title">챗봇 · AI 사용량</h2>
      {/* 이번 달 누적 (달러, 제작자 2026-11-13 '달러로 표시'): 11월은 콘솔 값 $216.46 에 그 뒤 앱이 센 만큼 */}
      {month && (
        <div className="ld-ai-month">
          <div>
            <span>{Number(month.month.slice(5))}월 누적</span>
            <b>
              <Pop v={Math.round(month.usd * 100)}>{usdText(month.usd)}</Pop>
            </b>
            <small>/ ${AI_MONTH_LIMIT}</small>
          </div>
          <i>
            <i style={{ transform: `scaleX(${Math.min(1, month.usd / AI_MONTH_LIMIT)})` }} />
          </i>
          <em>
            {month.console && month.refreshedAt
              ? `콘솔 기준 (${agoText(dash.now - month.refreshedAt)}까지) + 그 뒤 어림`
              : "앱이 센 어림값"}
          </em>
        </div>
      )}
      <div className="ld-ai-kpis">
        <div>
          <b>
            <Pop v={q}>{num(q)}</Pop>
          </b>
          <small>챗봇 질문 · {askers}명</small>
        </div>
        <div>
          <b>
            <Pop v={tok}>{tokText(tok)}</Pop>
          </b>
          <small>토큰 · 출력 {tokText(out)}</small>
        </div>
        <div>
          <b>
            <Pop v={Math.round(usd * 100)}>{usdText(usd)}</Pop>
          </b>
          <small>비용 · 웹 {num(web)}번</small>
        </div>
      </div>
      <p className="ld-readout">
        <b>
          {dayMD(days[sel].d)}({dayWeek(days[sel].d)})
        </b>{" "}
        챗봇 질문 {days[sel].q}
        {days[sel].tok > 0 && ` · 토큰 ${tokText(days[sel].tok)}`}
      </p>
      <BarChart values={days.map((d) => d.q)} sel={sel} onPick={setPick} fmt={num} labels={(i) => (i % 7 === (n - 1) % 7 ? dayMD(days[i].d) : "")} now={n - 1} height={110} dim={(i) => i < n - dash.period} />
      {dash.ai.length > 0 ? (
        <ul className="ld-ai-kinds">
          {dash.ai.map((k) => (
            <li key={k.kind}>
              <span>{AI_NAME[k.kind] ?? k.kind}</span>
              <span className="ld-row-bar">
                <i className="ld-seg-5" style={{ width: `${(k.calls / maxCalls) * 100}%` }} />
              </span>
              <b>
                {num(k.calls)}번 <small>{k.usd !== undefined ? usdText(k.usd) : tokText(k.input + k.output + k.cache)}</small>
              </b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ld-quiet">토큰은 오늘부터 쌓여요</p>
      )}
      {dash.aiSince !== null && <p className="ld-score-why">토큰 {dayMD(dash.aiSince)}부터 셈 · 질문 수는 처음부터</p>}
    </section>
  );
}

// ---------- 한 사람 ----------
export function PersonPanel({
  person,
  data,
  error,
  today,
  now,
  live,
  onRecords,
  onClose,
  children,
}: {
  person: DashPerson | undefined;
  id: string;
  data?: PersonDash;
  error: string;
  today: number;
  now: number;
  live: boolean;
  onRecords: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [pick, setPick] = useState<number | null>(null);
  const t = person ? tierOf(person.score) : "idle";
  const days = data?.daily ?? [];
  const n = days.length;
  const sel = pick !== null && pick < n ? pick : n - 1;
  return (
    <section className={"panel ld-person ld-t-" + t}>
      <div className="ld-person-head">
        <ScoreRing score={person?.score ?? 0} size={52} />
        <div>
          <h2>
            {live && <i className="ld-dot" aria-label="지금 접속 중" />}
            {person ? <Nick name={person.id} /> : "…"}
            <em className={"ld-tbadge ld-t-" + t}>{TIER_NAME[t]}</em>
          </h2>
          <small>
            {person?.alts.length ? `부캐 ${person.alts.join(", ")} · ` : ""}
            {person ? lastText(person.last, today) : ""}
          </small>
        </div>
        <button type="button" className="ld-x" aria-label="닫기" onClick={onClose}>
          ✕
        </button>
      </div>
      {person && (
        <div className="ld-person-kpis">
          <span>
            <b>{person.days}일</b>들어옴
          </span>
          <span>
            <b>{num(person.v)}</b>로그인
          </span>
          <span>
            <b>{minShort(person.m)}</b>사용
          </span>
          <span>
            <b>{num(person.w)}</b>화면
          </span>
          <span>
            <b>{num(person.a)}</b>한 일
          </span>
          <span>
            <b>{num(person.q)}</b>챗봇
          </span>
          <span>
            <b>{tokText(person.tok)}</b>토큰
          </span>
        </div>
      )}
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          {n > 1 && (
            <>
              <p className="ld-readout">
                <b>
                  {dayMD(days[sel].d)}({dayWeek(days[sel].d)})
                </b>{" "}
                로그인 {days[sel].v} · 화면 {num(days[sel].w)} · 한 일 {days[sel].a} · {minShort(days[sel].m)} · 챗봇 {days[sel].q}
              </p>
              <BarChart
                values={days.map((d) => d.w + d.a)}
                stack={days.map((d) => d.a)}
                sel={sel}
                onPick={setPick}
                fmt={num}
                labels={(i) => (n <= 7 ? dayWeek(days[i].d) : i % 7 === (n - 1) % 7 ? dayMD(days[i].d) : "")}
                now={n - 1}
                height={110}
              />
              <div className="ld-legend">
                <span>
                  <i className="ld-sw ld-sw-1" />본 화면
                </span>
                <span>
                  <i className="ld-sw ld-sw-2" />한 일
                </span>
              </div>
            </>
          )}
          <HeatPanel heat={data.heat} days={Math.max(7, data.period)} now={now} title="자주 쓰는 때" />
          {data.secs.length > 0 && <MenuPanel secs={data.secs} title="자주 쓰는 메뉴" />}
          {data.questions.length > 0 && (
            <section className="panel ld-qs">
              <h2 className="panel-title">최근 챗봇 질문</h2>
              <ul>
                {data.questions.map((q, i) => (
                  <li key={i}>
                    <small>{ago(q.at, now)}</small>
                    <span>
                      {q.text || "(첨부만)"}
                      {q.photos > 0 && <em> · 사진 {q.photos}</em>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.ai.length > 0 && (
            <section className="panel ld-ai">
              <h2 className="panel-title">AI 사용</h2>
              <ul className="ld-ai-kinds">
                {data.ai.map((k) => (
                  <li key={k.kind}>
                    <span>{AI_NAME[k.kind] ?? k.kind}</span>
                    <b>
                      {num(k.calls)}번 <small>{tokText(k.input + k.output)}</small>
                    </b>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {children}
        </>
      )}
      <button type="button" className="btn btn-ghost ld-records" onClick={onRecords}>
        이 사람 기록 보기 ›
      </button>
    </section>
  );
}
