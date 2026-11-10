// 2군 성장코인샵 시범운영: 주간 목표 레벨 선착순 (1주 진행·1주 휴식, 서버 server/gcrace.ts, 김다혜·제작자 2026-11-09).
// 성장 현황(리더보드 + 추월 차트), 상점 맨 위 성장 카드(달성률 · 성장반영), 담당자 '목표' 칸, 보상표.
// 달성한 사람이 찍은 순서대로 위(1위 확정), 아직인 사람은 달성률 순. 1~5위 달성자가 상금을 받는다
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { JOB_NAME, avatarUrl, errorText } from "../auth";
import { JobEmblem } from "../emblems";
import { Nick } from "../kakao";
import { useBackClose } from "../backClose";
import { COIN_GOLD, setRound, setTarget } from "../gcoin";
import type { GcRace, GcRaceEntry, GcRoundResult, GcWallet } from "../gcoin";

const MEDAL = ["🥇", "🥈", "🥉"];
/** 앞 세 사람 선 색 (dataviz 검사기 --pairs all 로 어두운 바탕 #1b1d3a 에서 통과: 파랑 · 주황 · 청록) */
const COLORS = ["#3987e5", "#d95926", "#199e70"];
const OTHER = "#59608a";
const ME = "#e3e9f6";
const DAY = 86_400_000;

const Coin = () => <i className="gc-coin" aria-hidden="true" />;

/** '11/9(월)' */
export function dayText(ms: number): string {
  const d = new Date(ms + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${"일월화수목금토"[d.getUTCDay()]})`;
}
/** '11/11 21:30' */
function whenText(ms: number): string {
  const d = new Date(ms + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
/** '11/11(수) 11:00' */
const atText = (ms: number) => `${dayText(ms)} ${whenText(ms).split(" ")[1]}`;
/** 끝나는 때: 0시면 그 전날 24:00 ('11/22(일) 24:00') */
const endText = (ms: number) => (whenText(ms).endsWith(" 00:00") ? `${dayText(ms - 1)} 24:00` : atText(ms));
/** 판 기간 '11/16(월) 00:00 ~ 11/22(일) 24:00' */
export const periodText = (race: { start: number; end: number }) => `${atText(race.start)} ~ ${endText(race.end)}`;
const pctShow = (p: number) => (Number.isInteger(p) ? String(p) : p.toFixed(1));

function Face({ e, size }: { e: GcRaceEntry; size: number }) {
  return e.avatar ? (
    <img
      className="growth-face"
      src={avatarUrl(e.id, e.avatar)}
      alt=""
      style={{ maxWidth: size, maxHeight: size }}
      draggable={false}
    />
  ) : (
    <JobEmblem job={e.job} size={size} />
  );
}

/** 닉네임 표 폭 어림 (12px 굵은 글씨, 한글 12.5px · 나머지 7.5px, 둘레 12px, 왕관 14px) */
function tagWidth(name: string, crown: boolean): number {
  let n = 12 + (crown ? 14 : 0);
  for (const ch of name) n += /[\u3131-\uD7A3]/.test(ch) ? 12.5 : 7.5;
  return n;
}

/**
 * 선 끝 닉네임 자리: 점 위, 아래, 두 칸 위·아래 차례로, 그 안에서 가운데·왼쪽·오른쪽으로 비켜
 * 앞 사람 표와 겹치지 않는 첫 자리 (모두 겹치면 처음 자리)
 */
function placeTags<P extends { e: GcRaceEntry; end: number; last: number }>(
  list: P[],
  x: (t: number) => number,
  y: (p: number) => number,
  w: number,
  bottom: number,
  keep: { l: number; r: number; t: number; b: number }[] = [],
) {
  const TH = 18;
  const boxes = [...keep];
  return list.map((p) => {
    const cx = x(p.end);
    const cy = y(p.last);
    const tw = tagWidth(p.e.id, p.e.rank === 1);
    const hw = tw / 2;
    const fit = (v: number) => Math.min(Math.max(v, hw + 2), w - hw - 2);
    let pick: { tx: number; ty: number } | null = null;
    for (const dy of [-15, 15, -35, 35, -55, 55]) {
      const ty = cy + dy;
      if (ty - TH / 2 < 2 || ty + TH / 2 > bottom) continue;
      for (const dx of [0, -(hw + 4), hw + 4]) {
        const tx = fit(cx + dx);
        const box = { l: tx - hw - 2, r: tx + hw + 2, t: ty - TH / 2 - 1, b: ty + TH / 2 + 1 };
        if (boxes.some((o) => o.l < box.r && box.l < o.r && o.t < box.b && box.t < o.b)) continue;
        boxes.push(box);
        pick = { tx, ty };
        break;
      }
      if (pick) break;
    }
    if (!pick) pick = { tx: fit(cx), ty: Math.max(cy - 15, TH / 2 + 2) };
    return { p, cx, cy, ...pick };
  });
}

/** 어떤 때의 달성률 (그 때까지 마지막 점) */
function valueAt(pts: [number, number][], t: number): number {
  let v = 0;
  for (const [at, p] of pts) {
    if (at > t) break;
    v = p;
  }
  return v;
}

interface Overtake {
  t: number;
  p: number;
  a: string;
  b: string;
}
/** 추월: 누가 달성률을 올리며 다른 사람을 넘어선 때 (A 의 전 값 <= B < A 의 새 값) */
function overtakes(race: GcRace): Overtake[] {
  const out: Overtake[] = [];
  const ids = race.list.map((e) => e.id);
  for (const a of ids) {
    const pts = race.series[a] ?? [];
    for (let i = 1; i < pts.length; i++) {
      const [t, p] = pts[i];
      const p0 = pts[i - 1][1];
      for (const b of ids) {
        if (b === a) continue;
        const v = valueAt(
          (race.series[b] ?? []).filter(([at]) => at < t),
          t,
        );
        if (p0 <= v && v < p) out.push({ t, p, a, b });
      }
    }
  }
  return out.sort((x, y) => x.t - y.t);
}

/**
 * 추월 차트 (제작자 2026-11-09 '누가 추월하고 이런 거도 차트로, x축은 2주 y축은 달성률, 이펙트 팍팍, 고급지고 귀엽게'):
 * 사람마다 계단 선(적을 때마다 오른다), 앞 세 사람은 색, 나는 흰색, 나머지는 회색. 선 끝에 얼굴, 1위 머리에 왕관, 추월한 자리에 반짝이,
 * 100% 는 체크무늬 결승선, 오늘 세로 점선, 1위 선을 따라 빛이 달린다. 줄이나 차트를 누르면 그 사람 선이 앞으로
 */
function RaceChart({
  race,
  me,
  pick,
  onPick,
  now,
}: {
  race: GcRace;
  me: string;
  pick: string | null;
  onPick: (id: string) => void;
  now: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(300);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 176;
  const L = 30;
  const R = 26;
  const T = 30;
  const B = 20;
  const tNow = Math.min(Math.max(now, race.start), race.end);
  const days = Math.round((race.end - race.start) / DAY);
  const x = (t: number) =>
    L + ((t - race.start) / (race.end - race.start)) * (w - L - R);
  const y = (p: number) => T + (1 - p / 100) * (H - T - B);
  const colorOf = new Map(
    race.list.slice(0, 3).map((e, i) => [e.id, COLORS[i]]),
  );
  const color = (id: string) => colorOf.get(id) ?? (id === me ? ME : OTHER);
  const paths = race.list.map((e) => {
    const pts = race.series[e.id]?.length
      ? race.series[e.id]
      : ([[race.start, 0]] as [number, number][]);
    const end = e.doneAt ?? tNow;
    let d = `M${x(pts[0][0]).toFixed(1)},${y(pts[0][1]).toFixed(1)}`;
    for (const [t, p] of pts.slice(1))
      d += `H${x(t).toFixed(1)}V${y(p).toFixed(1)}`;
    d += `H${x(end).toFixed(1)}`;
    return { e, d, end, last: pts[pts.length - 1][1] };
  });
  const order = (id: string) =>
    id === pick ? 4 : id === me ? 3 : colorOf.has(id) ? 2 : 1;
  const drawn = [...paths].sort((a, b) => order(a.e.id) - order(b.e.id));
  const ot = useMemo(() => overtakes(race), [race]);
  const lastOt = ot[ot.length - 1];
  const leader = paths.find((p) => p.e.rank === 1);
  const faces = paths.filter(
    (p) => colorOf.has(p.e.id) || p.e.id === me || p.e.id === pick,
  );
  const tags = placeTags(
    [...faces].sort((a, b) => a.e.rank - b.e.rank),
    x,
    y,
    w,
    H - B,
    // '오늘' 글자 자리는 비워 둔다
    now < race.end ? [{ l: x(tNow) - 15, r: x(tNow) + 15, t: T - 18, b: T - 2 }] : [],
  );
  const reduce =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    id: string;
    t: number;
  } | null>(null);

  function tap(ev: React.PointerEvent<SVGSVGElement>) {
    const r = ev.currentTarget.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const py = ev.clientY - r.top;
    const t = race.start + ((px - L) / (w - L - R)) * (race.end - race.start);
    if (t < race.start || t > tNow) return;
    let best: { id: string; d: number } | null = null;
    for (const p of paths) {
      if (t > p.end) continue;
      const dy = Math.abs(y(valueAt(race.series[p.e.id] ?? [], t)) - py);
      if (!best || dy < best.d) best = { id: p.e.id, d: dy };
    }
    if (!best) return;
    onPick(best.id);
    setTip({
      x: px,
      y: y(valueAt(race.series[best.id] ?? [], t)),
      id: best.id,
      t,
    });
  }

  return (
    <div className="gr-chart" ref={box}>
      <div className="gr-plot">
        <svg
          width={w}
          height={H}
          onPointerDown={tap}
          role="img"
          aria-label="주간 목표 달성률 추월 차트"
        >
          <defs>
            <pattern
              id="gr-check"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
            >
              <rect width="3" height="3" fill="#fff3b0" />
              <rect x="3" y="3" width="3" height="3" fill="#fff3b0" />
            </pattern>
          </defs>
          {/* 눈금: 50% 와 날마다 옅은 선, 일주일 선은 조금 진하게 */}
          {Array.from({ length: days + 1 }, (_, i) => (
            <line
              key={i}
              className={i % 7 === 0 ? "gr-grid-w" : "gr-grid"}
              x1={x(race.start + i * DAY)}
              x2={x(race.start + i * DAY)}
              y1={y(100)}
              y2={y(0)}
            />
          ))}
          <line className="gr-grid" x1={L} x2={w - R} y1={y(50)} y2={y(50)} />
          <line className="gr-axis" x1={L} x2={w - R} y1={y(0)} y2={y(0)} />
          <text className="gr-tick" x={L - 4} y={y(50) + 3} textAnchor="end">
            50
          </text>
          <text className="gr-tick" x={L - 4} y={y(0) + 3} textAnchor="end">
            0%
          </text>
          {[0, Math.round(days / 2), days].map((dd) => (
            <text
              key={dd}
              className="gr-tick"
              x={x(race.start + dd * DAY)}
              y={H - 5}
              textAnchor={dd === 0 ? "start" : dd === days ? "end" : "middle"}
            >
              {dayText(race.start + dd * DAY).replace(/\(.\)/, "")}
            </text>
          ))}
          {/* 결승선 (100%) */}
          <rect
            className="gr-finish"
            x={L}
            y={y(100) - 3}
            width={w - L - R}
            height={6}
            fill="url(#gr-check)"
          />
          <text className="gr-flag" x={w - R + 3} y={y(100) + 4}>
            🏁
          </text>
          {/* 오늘 */}
          {now < race.end && (
            <g className="gr-today">
              <line x1={x(tNow)} x2={x(tNow)} y1={y(100) + 4} y2={y(0)} />
              <text x={x(tNow)} y={T - 6} textAnchor="middle">
                오늘
              </text>
            </g>
          )}
          {drawn.map(({ e, d }) => (
            <path
              key={e.id}
              d={d}
              className={
                "gr-line" +
                (e.id === pick
                  ? " gr-line-pick"
                  : pick && pick !== e.id
                    ? " gr-line-dim"
                    : "")
              }
              stroke={color(e.id)}
              strokeWidth={
                colorOf.has(e.id) || e.id === me || e.id === pick ? 2.4 : 1.4
              }
              strokeDasharray={
                e.id === me && !colorOf.has(e.id) ? "5 3" : undefined
              }
            />
          ))}
          {/* 1위 선을 따라 달리는 빛 */}
          {leader && !reduce && (
            <circle r="3" className="gr-comet">
              <animateMotion
                dur="2.8s"
                repeatCount="indefinite"
                path={leader.d}
              />
            </circle>
          )}
          {/* 추월한 자리마다 반짝이 */}
          {ot.slice(-12).map((o, i) => (
            <g
              key={i}
              className="gr-spark"
              transform={`translate(${x(o.t).toFixed(1)},${y(o.p).toFixed(1)})`}
              style={{ animationDelay: `${(i % 4) * 0.35}s` }}
            >
              <path d="M0,-6 L1.6,-1.6 L6,0 L1.6,1.6 L0,6 L-1.6,1.6 L-6,0 L-1.6,-1.6Z" />
            </g>
          ))}
          {/* 나머지 사람의 선 끝 점 */}
          {paths
            .filter((p) => !faces.includes(p))
            .map((p) => (
              <circle
                key={p.e.id}
                cx={x(p.end)}
                cy={y(p.last)}
                r="2.6"
                fill={OTHER}
                className="gr-dot"
              />
            ))}
          {tip && (
            <line
              className="gr-cross"
              x1={tip.x}
              x2={tip.x}
              y1={y(100)}
              y2={y(0)}
            />
          )}
        </svg>
        {/* 선 끝 점과 닉네임 (앞 세 사람, 나, 고른 사람). 1위는 왕관 */}
        {tags.map(({ p, cx, cy, tx, ty }) => (
          <Fragment key={p.e.id}>
            <span
              className={
                "gr-end" + (p.e.doneAt !== null ? " gr-end-done" : "")
              }
              style={{ left: cx, top: cy, ["--c" as string]: color(p.e.id) }}
            />
            <span
              className={
                "gr-tag" + (p.e.id === pick ? " gr-tag-on" : "")
              }
              style={{
                left: tx,
                top: ty,
                ["--c" as string]: color(p.e.id),
                ["--t" as string]: p.e.id === me && !colorOf.has(me) ? "#12142b" : "#fff",
              }}
              onClick={() => onPick(p.e.id)}
            >
              {p.e.rank === 1 && <em className="gr-crown">👑</em>}
              {p.e.id}
            </span>
          </Fragment>
        ))}
        {tip && (
          <span
            className="gr-tip"
            style={{
              left: Math.min(Math.max(tip.x, 60), w - 60),
              top: tip.y,
            }}
          >
            <b>{tip.id}</b> {pctShow(valueAt(race.series[tip.id] ?? [], tip.t))}
            % · {whenText(tip.t)}
          </span>
        )}
      </div>
      {lastOt && (
        <p className="gr-ot">
          <span className="gr-ot-star">✨</span> <b>{lastOt.a}</b> 님이{" "}
          <b>{lastOt.b}</b> 님 추월 · {whenText(lastOt.t)}
        </p>
      )}
    </div>
  );
}

/**
 * 성장 현황 (리더보드): 맨 위 기간과 1~5위 상금, 추월 차트, 그 아래 한 줄씩.
 * 달성한 사람은 금색 '확정' 도장과 상금, 아직인 사람은 달성률 막대. 목표를 아무도 안 정했으면 예시를 보인다
 */
export function RaceBoard({
  race,
  me,
  sample,
  now,
}: {
  race: GcRace;
  me: string;
  sample: boolean;
  now: number;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const toggle = (id: string) => setPick((p) => (p === id ? null : id));
  const left = Math.max(0, Math.ceil((race.end - now) / DAY));
  return (
    <div className="gr">
      <div className="gr-head">
        <span className="gr-period">
          {periodText(race)}
          <b className="gr-dday">{now < race.start ? "시작 전" : now >= race.end ? "끝" : `D-${left}`}</b>
          {sample && <i className="sample-tag">예시</i>}
        </span>
        <span className="gr-prizes">
          {race.prizes.map((c, i) => (
            <span key={i} className={"gr-prize gr-prize-" + (i + 1)}>
              {MEDAL[i] ?? `${i + 1}위`}
              <Coin />
              {c}
            </span>
          ))}
        </span>
      </div>
      {now >= race.end && (
        <p className="gr-next">
          {race.next ? `다음 판 ${atText(race.next)}` : "다음 판 미정"}
        </p>
      )}
      <RaceChart race={race} me={me} pick={pick} onPick={toggle} now={now} />
      <ol className="gr-list">
        {race.list.map((e) => {
          const done = e.doneAt !== null;
          const c =
            race.list.findIndex((x) => x.id === e.id) < 3
              ? COLORS[race.list.findIndex((x) => x.id === e.id)]
              : undefined;
          return (
            <li
              key={e.id}
              className={
                "gr-row" +
                (done ? " gr-done" : "") +
                (e.id === me ? " gr-mine" : "") +
                (pick === e.id ? " gr-pick" : "") +
                (done && e.rank <= 3 ? " gr-podium" : "")
              }
              onClick={() => toggle(e.id)}
            >
              <span
                className={
                  "gr-rank gr-rank-" + e.rank + (done ? "" : " gr-rank-run")
                }
              >
                {done && e.rank <= 3 ? MEDAL[e.rank - 1] : e.rank}
              </span>
              <span
                className="gr-face"
                style={c ? { ["--c" as string]: c } : undefined}
              >
                <Face e={e} size={30} />
              </span>
              <span className="gr-main">
                <span className="gr-name">
                  <Nick name={e.id} />
                  <small>
                    {JOB_NAME[e.job]} · Lv.{e.fromLevel} → {e.target}
                  </small>
                </span>
                <span className="gr-bar">
                  <i style={{ transform: `scaleX(${e.pct / 100})` }} />
                </span>
              </span>
              <span className="gr-val">
                {done ? (
                  <>
                    <b className="gr-stamp">확정</b>
                    {e.coins > 0 && (
                      <small>
                        <Coin />+{e.coins}
                      </small>
                    )}
                  </>
                ) : (
                  <>
                    <b>{pctShow(e.pct)}%</b>
                    <small>Lv.{e.level}</small>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {done(race.list) === 0 && race.list.length > 0 && (
        <p className="gr-foot">목표 레벨을 먼저 찍으면 1위 확정</p>
      )}
    </div>
  );
}
const done = (l: GcRaceEntry[]) => l.filter((e) => e.doneAt !== null).length;

/** 숫자가 0 에서 올라간다 (달성률) */
function CountUp({ n }: { n: number }) {
  return <b className="gr-card-num gc-pop">{pctShow(n)}</b>;
}

/**
 * 상점 맨 위 성장 카드 (제작자 2026-11-09 '상점의 성장 카드는 달성률이 나오게', '성장 카드에 성장 반영을 할 수 있는 버튼, 겸치랑 렙 입력하면 길드 랭킹에도 연동'):
 * 큰 달성률과 지금 순위, 시작 레벨 ~ 목표 레벨 막대(레벨마다 눈금, 지금 자리에 깃발), '성장반영'
 */
export function RaceCard({
  entry,
  race,
  onEdit,
  editing,
}: {
  entry: GcRaceEntry | null;
  race: GcRace;
  onEdit: () => void;
  editing: boolean;
}) {
  const span = entry ? entry.target - entry.fromLevel : 0;
  const ticks = entry
    ? Array.from(
        { length: Math.max(0, span - 1) },
        (_, i) => entry.fromLevel + i + 1,
      )
    : [];
  return (
    <div className={"gr-card" + (entry?.doneAt ? " gr-card-done" : "")}>
      <div className="gr-card-top">
        {entry ? (
          <>
            <span className="gr-card-pct">
              <CountUp n={entry.pct} />%<small>달성률</small>
            </span>
            <span className="gr-card-rank">
              {entry.doneAt !== null ? (
                <>
                  🏁 {entry.rank}위 확정
                  {entry.coins > 0 && (
                    <em>
                      {" "}
                      · <Coin />+{entry.coins}
                    </em>
                  )}
                </>
              ) : (
                <>
                  {entry.rank}위 <small>/ {race.list.length}명</small>
                </>
              )}
            </span>
          </>
        ) : (
          <span className="gr-card-none">목표 미정</span>
        )}
        <button
          className={"gr-edit-btn" + (editing ? " gr-edit-on" : "")}
          onClick={onEdit}
        >
          성장반영
        </button>
      </div>
      {entry && (
        <div className="gr-card-bar">
          <span>Lv.{entry.fromLevel}</span>
          <span className="gr-track">
            <i style={{ transform: `scaleX(${entry.pct / 100})` }} />
            {ticks.map((l) => (
              <span
                key={l}
                className={
                  "gr-tick-lv" + (entry.level >= l ? " gr-tick-on" : "")
                }
                style={{ left: `${((l - entry.fromLevel) / span) * 100}%` }}
              >
                <em>{l}</em>
              </span>
            ))}
            <span className="gr-flag-me" style={{ left: `${entry.pct}%` }} />
          </span>
          <span className="gr-goal">🏁{entry.target}</span>
        </div>
      )}
    </div>
  );
}

/** 보상표 창 (성장 카드의 '보상표'): 주간 목표 선착순 1~5위 상금 */
export function PrizeSheet({
  race,
  onClose,
}: {
  race: GcRace;
  onClose: () => void;
}) {
  useBackClose(true, onClose);
  return createPortal(
    <div className="gc-sheet-back" onClick={onClose}>
      <div
        className="gc-curve gc-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <p className="gc-week-head">
          <b>보상표</b>
          <small>{periodText(race)}</small>
          <button
            className="pill gc-mini gc-sheet-x"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </p>
        <ul>
          {race.prizes.map((c, i) => (
            <li key={i} className="gr-prize-row">
              <span>{MEDAL[i] ?? `${i + 1}위`}</span>
              <span>목표 {i + 1}번째 달성</span>
              <b>
                <Coin />
                {c}
              </b>
              <small className="gc-curve-step">{goldText(c)}</small>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/** 코인이 몇만 골드인지 (1코인 = 3만 골드) */
export const goldText = (coin: number) =>
  `${((coin * COIN_GOLD) / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만 골드`;

/**
 * 담당자 > 목표 (김다혜 2026-11-09 '2주간의 목표 레벨은 담당자가 정해 주고'): 2군 본캐마다 지금 레벨과 목표 레벨(− +). 처음 칸은 지금 레벨 + 2 를 흐리게 권하고 '저장'으로 정한다.
 * 정한 사람은 '빼기'. 정할 때 레벨이 달성률의 0%
 */
export function TargetsTab({
  members,
  race,
  onChanged,
}: {
  members: GcWallet[];
  race: GcRace;
  onChanged: (msg: string) => void;
}) {
  // 끝났으면 다음 판 목표를 정한다 (server/gcrace.ts targetRound). 다음 판을 안 정했으면 기간부터
  const ended = Date.now() >= race.end;
  const next = ended && race.next ? race.next : null;
  const set = new Map<string, TargetEntry>(
    ended ? (race.upcoming ?? []).map((e) => [e.id, { ...e, doneAt: null, rank: 0 }]) : race.list.map((e) => [e.id, e]),
  );
  const list = [...members].sort(
    (a, b) =>
      Number(set.has(b.id)) - Number(set.has(a.id)) ||
      (b.level ?? 0) - (a.level ?? 0) ||
      a.id.localeCompare(b.id),
  );
  const period = !ended
    ? { start: race.start, end: race.end }
    : next && race.nextEnd
      ? { start: next, end: race.nextEnd }
      : null;
  return (
    <div className="panel gr-targets">
      <PeriodEditor key={`${period?.start}-${period?.end}`} period={period} after={race.end} onChanged={onChanged} />
      <p className="gc-week-head">
        <b>{ended ? "다음 판 목표" : "주간 목표"}</b>
        <small>{set.size}명</small>
      </p>
      {!period && <p className="gc-empty">기간을 먼저 정해 주세요</p>}
      {!list.length && <p className="gc-empty">2군 본캐가 없어요</p>}
      <ul hidden={!period}>
        {list.map((m) => (
          <TargetRow
            key={m.id}
            m={m}
            e={set.get(m.id) ?? null}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </div>
  );
}

const KST = 9 * 3600_000;
/** 한국 시간 그날 0시 */
const dayStart = (ms: number) => Math.floor((ms + KST) / DAY) * DAY - KST;
/** '2026-11-11' */
const dayKey = (ms: number) => new Date(ms + KST).toISOString().slice(0, 10);

/**
 * 이벤트 기간 (제작자 2026-11-10 '며칠 00시부터 며칠 24시까지 이벤트 기간 설정'): 시작 날 0시 ~ 끝 날 24시를 − + 로.
 * period 가 없으면(다음 판 미정) 끝난 판 다음 주로 새 판을 권한다
 */
function PeriodEditor({
  period,
  after,
  onChanged,
}: {
  period: { start: number; end: number } | null;
  after: number;
  onChanged: (msg: string) => void;
}) {
  const s0 = period ? dayStart(period.start) : dayStart(Math.max(after, Date.now()) + 7 * DAY);
  const e0 = period ? dayStart(period.end - 1) : s0 + 6 * DAY;
  const [from, setFrom] = useState(s0);
  const [to, setTo] = useState(e0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = !period || from !== s0 || to !== e0;
  async function save() {
    setBusy(true);
    setError("");
    try {
      await setRound(dayKey(from), dayKey(to));
      onChanged(`기간 ${dayText(from)} ~ ${dayText(to)}`);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  const step = (v: number, set: (n: number) => void, lo: number, label: string) => (
    <span className="gc-step gr-pd-step">
      <button className="pill" disabled={busy || v - DAY < lo} onClick={() => set(v - DAY)} aria-label={`${label} 하루 앞으로`}>
        −
      </button>
      <b key={v} className="gc-pop">{dayText(v)}</b>
      <button className="pill" disabled={busy} onClick={() => set(v + DAY)} aria-label={`${label} 하루 뒤로`}>
        +
      </button>
    </span>
  );
  return (
    <div className="gr-pd">
      <p className="gc-week-head">
        <b>{period ? "기간" : "다음 판 기간"}</b>
        <small>
          {dayText(from)} 00:00 ~ {dayText(to)} 24:00 · {Math.round((to - from) / DAY) + 1}일
        </small>
      </p>
      <div className="gr-pd-row">
        {step(from, (n) => { setFrom(n); if (n > to) setTo(n); }, -Infinity, "시작")}
        <span className="gr-pd-sep">~</span>
        {step(to, setTo, from, "끝")}
        {dirty && (
          <button className="pill gc-mini gc-done-btn" disabled={busy} onClick={save}>
            {period ? "저장" : "정하기"}
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

type TargetEntry = { fromLevel: number; target: number; doneAt: number | null; rank: number };

function TargetRow({
  m,
  e,
  onChanged,
}: {
  m: GcWallet;
  e: TargetEntry | null;
  onChanged: (msg: string) => void;
}) {
  const lv = m.level ?? 1;
  const base = e?.fromLevel ?? lv;
  const [t, setT] = useState(e?.target ?? lv + 2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = !e || t !== e.target;
  async function run(target: number | null, msg: string) {
    setBusy(true);
    setError("");
    try {
      await setTarget(m.id, target);
      onChanged(msg);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={"gr-tg" + (e ? " gr-tg-set" : "")}>
      <span className="gr-tg-name">
        <Nick name={m.id} />
        <small>Lv.{lv}</small>
      </span>
      <span className="gc-step gr-tg-step">
        <button
          className="pill"
          disabled={busy || t <= base + 1}
          onClick={() => setT((x) => x - 1)}
          aria-label="목표 내리기"
        >
          −
        </button>
        <b key={t} className={"gc-pop" + (e ? "" : " gr-tg-suggest")}>
          Lv.{t}
        </b>
        <button
          className="pill"
          disabled={busy || t >= 99}
          onClick={() => setT((x) => x + 1)}
          aria-label="목표 올리기"
        >
          +
        </button>
      </span>
      {dirty ? (
        <button
          className="pill gc-mini gc-done-btn"
          disabled={busy}
          onClick={() => run(t, `${m.id} 목표 Lv.${t}`)}
        >
          {e ? "저장" : "정하기"}
        </button>
      ) : (
        <button
          className="pill gc-mini"
          disabled={busy}
          onClick={() => run(null, `${m.id} 목표 뺌`)}
        >
          빼기
        </button>
      )}
      {e?.doneAt && <small className="gr-tg-done">🏁 {e.rank}위</small>}
      {error && <small className="form-error">{error}</small>}
    </li>
  );
}

/**
 * 담당자 > 기록 (제작자 2026-11-10 '이벤트 종료하면 1차 이벤트 결과를 기록으로 남겨, 담당자 -> 기록 메뉴, 보상 버튼 오른쪽'):
 * 끝난 판마다 'N차 · 기간 · 명', 순위 · 닉네임 · Lv.시작 → 목표 · 달성한 때(못 했으면 끝날 때 달성률) · 받은 상금. 서버 gc_round_results
 */
export function RecordsTab({ results }: { results: GcRoundResult[] }) {
  const rounds = new Map<number, GcRoundResult[]>();
  for (const r of results) rounds.set(r.round, [...(rounds.get(r.round) ?? []), r]);
  // 차수는 오래된 판부터 1차 (화면은 최근 판이 위)
  const order = [...rounds.keys()].sort((a, b) => rounds.get(a)![0].start - rounds.get(b)![0].start);
  if (!rounds.size) return <div className="empty">아직 끝난 판이 없어요</div>;
  return (
    <>
      {[...order].reverse().map((id) => {
        const list = rounds.get(id)!;
        const head = list[0];
        const done = list.filter((e) => e.doneAt !== null).length;
        const paid = list.reduce((n, e) => n + e.coins, 0);
        return (
          <div key={id} className="panel gr-rec">
            <p className="gc-week-head">
              <b>{order.indexOf(id) + 1}차</b>
              <small>{periodText(head)}</small>
            </p>
            <p className="gr-rec-sum">
              {list.length}명 · 달성 {done}명 · 상금 <Coin />
              {paid}
            </p>
            <ol className="gr-rec-list">
              {list.map((e) => (
                <li key={e.userId} className={e.doneAt !== null ? "gr-rec-done" : ""}>
                  <span className="gr-rec-rank">{e.doneAt !== null && e.rank <= 3 ? MEDAL[e.rank - 1] : e.rank}</span>
                  <span className="gr-rec-name">
                    <Nick name={e.userId} />
                    <small>
                      Lv.{e.fromLevel} → {e.target}
                    </small>
                  </span>
                  <span className="gr-rec-when">{e.doneAt !== null ? whenText(e.doneAt) : `${pctShow(e.pct)}%`}</span>
                  <b className="gr-rec-coin">
                    {e.coins ? (
                      <>
                        <Coin />
                        {e.coins}
                      </>
                    ) : (
                      ""
                    )}
                  </b>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </>
  );
}
