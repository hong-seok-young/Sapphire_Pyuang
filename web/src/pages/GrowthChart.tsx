// 랭킹에서 닉네임을 누르면 펼쳐지는 레벨·경험치 그래프 (제작자 요청 2026-10-31). 길드원이 레벨, 경험치를 적을 때마다
// 남긴 기록(level_log)을 그린다. 레벨과 경험치를 한 값으로 이어서 (Lv.50 경험치 37.5% -> 50.375) 레벨업한 점에 ▲ 를 붙인다.
// 칸이 펼쳐지고, 선이 왼쪽부터 그려지고, 점이 차례로 나타난다 (움직임 줄이기 설정이면 바로 다 보인다. styles.css 'growth chart')
import { useCallback, useId } from "react";
import type { CSSProperties } from "react";
import { expText, fetchHistory, growthText } from "../auth";
import type { LevelLogEntry } from "../auth";
import { useAsync } from "../data";
import { Loading } from "../ui";

const W = 320;
const H = 160;
/** 왼쪽은 레벨 숫자, 아래는 날짜 자리 */
const PAD = { l: 28, r: 14, t: 20, b: 22 };
/** 레벨업 글자는 많으면 겹쳐서 마지막 몇 개만 */
const MAX_UP_LABELS = 4;

const value = (p: LevelLogEntry) => p.level + (p.exp ?? 0) / 100_000;
const dateText = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const pointText = (p: LevelLogEntry) => `Lv.${p.level}${p.exp !== null ? ` ${expText(p.exp)}` : ""}`;

/** 처음부터 지금까지 오른 만큼. 어느 한쪽 경험치를 안 적었으면 레벨만 센다 (성장 랭킹과 같은 셈) */
function grownText(from: LevelLogEntry, to: LevelLogEntry): string {
  const g = (to.level - from.level) * 100_000 + (from.exp === null || to.exp === null ? 0 : to.exp - from.exp);
  return g > 0 ? growthText(g) : "그대로";
}

export function GrowthChart({ id }: { id: string }) {
  const { data, error } = useAsync(useCallback(() => fetchHistory(id), [id]));
  const gradient = "gc" + useId().replace(/:/g, "");
  if (!data) {
    return (
      <div className="gc">
        <Loading error={error} />
      </div>
    );
  }

  const now = Date.now();
  const pts: LevelLogEntry[] = data.points.slice();
  const last = pts[pts.length - 1];
  if (!last || last.level !== data.profile.level || last.exp !== data.profile.exp) {
    pts.push({ at: Math.max(now, last?.at ?? 0), level: data.profile.level, exp: data.profile.exp });
  }
  const first = pts[0];
  const cur = pts[pts.length - 1];
  if (pts.length < 2) {
    return (
      <div className="gc">
        <p className="gc-empty">기록이 하나뿐이라 아직 그래프가 없어요. 지금 {pointText(cur)}</p>
      </div>
    );
  }

  const t0 = first.at;
  const t1 = Math.max(now, cur.at);
  const span = Math.max(t1 - t0, 3_600_000);
  const vals = pts.map(value);
  const lo = Math.floor(Math.min(...vals));
  const hi = Math.max(lo + 1, Math.ceil(Math.max(...vals)));
  const plotW = W - PAD.l - PAD.r;
  const x = (t: number) => PAD.l + ((t - t0) / span) * plotW;
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const step = Math.max(1, Math.ceil((hi - lo) / 4));
  const grid: number[] = [];
  for (let lv = lo; lv <= hi; lv += step) grid.push(lv);

  const xy = pts.map((p) => [x(p.at), y(value(p))] as const);
  const line = xy.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)} ${b.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  const bottom = H - PAD.b;
  const area = `${line} L${lx.toFixed(1)} ${bottom} L${xy[0][0].toFixed(1)} ${bottom} Z`;
  const endX = x(t1);
  /** 점이 나타나는 때: 선이 그 점까지 그려졌을 즈음 */
  const delay = (a: number): CSSProperties => ({ "--d": `${(0.15 + ((a - PAD.l) / plotW) * 0.8).toFixed(2)}s` }) as CSSProperties;
  const ups = pts.map((p, i) => (i > 0 && p.level > pts[i - 1].level ? i : -1)).filter((i) => i >= 0);

  return (
    <div className="gc">
      <svg className="gc-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${id} 레벨·경험치 그래프: ${pointText(first)}에서 ${pointText(cur)}`}>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="gc-stop-a" />
            <stop offset="1" className="gc-stop-b" />
          </linearGradient>
        </defs>
        <text className="gc-axis" x={PAD.l - 5} y={9} textAnchor="end">
          Lv
        </text>
        {grid.map((lv) => (
          <g key={lv}>
            <line className="gc-grid" x1={PAD.l} x2={W - PAD.r} y1={y(lv)} y2={y(lv)} />
            <text className="gc-axis" x={PAD.l - 5} y={y(lv) + 4} textAnchor="end">
              {lv}
            </text>
          </g>
        ))}
        <path className="gc-area" d={area} fill={`url(#${gradient})`} />
        <path className="gc-line" d={line} pathLength={1} />
        {/* 마지막 기록 뒤로는 새로 적은 게 없다: 오늘까지 점선 */}
        {endX - lx > 4 && <line className="gc-rest" x1={lx} y1={ly} x2={endX} y2={ly} />}
        {xy.map(([a, b], i) => (
          <rect key={i} className={"gc-dot" + (ups.includes(i) ? " gc-dot-up" : "")} x={a - 2.5} y={b - 2.5} width={5} height={5} style={delay(a)} />
        ))}
        {ups.slice(-MAX_UP_LABELS).map((i) => {
          const [a, b] = xy[i];
          return (
            <text key={i} className="gc-up" x={Math.min(W - PAD.r - 10, Math.max(PAD.l + 10, a))} y={b - 8 < 10 ? b + 15 : b - 8} textAnchor="middle" style={delay(a)}>
              ▲{pts[i].level}
            </text>
          );
        })}
        <text className="gc-axis" x={PAD.l} y={H - 6}>
          {dateText(t0)}
        </text>
        <text className="gc-axis" x={W - PAD.r} y={H - 6} textAnchor="end">
          오늘
        </text>
      </svg>
      <p className="gc-sum">
        <span>
          {dateText(t0)} {pointText(first)}
        </span>
        <span>→</span>
        <b>지금 {pointText(cur)}</b>
        <em>{grownText(first, cur)}</em>
      </p>
    </div>
  );
}
