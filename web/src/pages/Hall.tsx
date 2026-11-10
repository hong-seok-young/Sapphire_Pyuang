// 명예의 전당 (개발중, 제작자 2026-11-10 마을모금함 '마일리지 순위표, 명예의 전당' -> 퓨앙 '명예의 전당은 별도 버튼으로, 최대한 고급지고 화려하고 가장 임팩트 있게').
// 기부(기부함 확정 + 장비대여 기부)로 쌓인 마일리지 순. 1~3위 단상(빛기둥·마법진·월계관·왕관), 4위부터 금속 명판, 누르면 그 사람의 기부.
// 서버 functions/api/donate/hall.ts (server/donate.ts hallOfFame). 움직임은 보는 동안만 transform·opacity, 움직임 줄이기면 멈춘다
import { useCallback, useMemo, useState } from "react";
import { avatarUrl } from "../auth";
import type { Me } from "../auth";
import { useAsync } from "../data";
import { JobEmblem } from "../emblems";
import { HeroHalo } from "../heroHalo";
import { Nick } from "../kakao";
import { useEntryState } from "../router";
import { Loading, TopBar } from "../ui";
import { PLACE_NAME, dayText, fetchHall, goldText, mileText, sampleHall } from "../donate";
import type { GiftLine, HallRow } from "../donate";

function Face({ h, size }: { h: HallRow; size: number }) {
  if (h.avatar) return <img className="growth-face" src={avatarUrl(h.name, h.avatar)} alt="" style={{ maxWidth: size, maxHeight: size }} draggable={false} />;
  if (h.job) return <JobEmblem job={h.job} size={size} />;
  return <span className="hof-face-none">🎁</span>;
}

/** 월계관 (잎 열한 장씩 양쪽 호를 따라) */
function Laurel({ size }: { size: number }) {
  const leaves = useMemo(() => {
    const out: { x: number; y: number; r: number }[] = [];
    for (const side of [-1, 1])
      for (let i = 0; i < 11; i++) {
        const a = ((200 - i * 15) * Math.PI) / 180;
        const x = 50 + side * Math.cos(a) * -44;
        const y = 54 + Math.sin(a) * -44;
        out.push({ x, y, r: side * (i * 15 - 65) });
      }
    return out;
  }, []);
  return (
    <svg className="hof-laurel" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <linearGradient id="hofLeaf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff4c2" />
          <stop offset="0.5" stopColor="#f2c14e" />
          <stop offset="1" stopColor="#a8741a" />
        </linearGradient>
      </defs>
      {leaves.map((l, i) => (
        <ellipse key={i} cx={l.x} cy={l.y} rx="3.2" ry="7" fill="url(#hofLeaf)" transform={`rotate(${l.r} ${l.x} ${l.y})`} />
      ))}
    </svg>
  );
}

/* ---------- 프로필 둘레 초안 다섯 (제작자 2026-11-10 '월계수 관 별로, 5개 안'). 이 기기 localStorage sapphire.hof.frame 1~5, 없으면 예전 월계관 ---------- */
const METAL: Record<1 | 2 | 3, [string, string, string]> = {
  1: ["#fff6cf", "#f2c14e", "#9a6a14"],
  2: ["#ffffff", "#c6cfe0", "#6f7a92"],
  3: ["#ffe1c6", "#d8894b", "#74401c"],
};
function MetalGrad({ id, rank }: { id: string; rank: 1 | 2 | 3 }) {
  const [a, b, c] = METAL[rank];
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor={a} />
      <stop offset="0.5" stopColor={b} />
      <stop offset="1" stopColor={c} />
    </linearGradient>
  );
}
function SapphireGrad({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#bfe0ff" />
      <stop offset="0.45" stopColor="#4f86ff" />
      <stop offset="1" stopColor="#1c2f9e" />
    </linearGradient>
  );
}
const frameKind = () => {
  try {
    return Number(localStorage.getItem("sapphire.hof.frame")) || 0;
  } catch {
    return 0;
  }
};

/** 1안 도트 액자: 계단 모서리 금속 테두리, 위에 도트 사파이어 */
function PixelFrame({ rank, size }: { rank: 1 | 2 | 3; size: number }) {
  const m = `hofPx${rank}`;
  const outer = "6,1 26,1 26,2 28,2 28,4 30,4 30,6 31,6 31,26 30,26 30,28 28,28 28,30 26,30 26,31 6,31 6,30 4,30 4,28 2,28 2,26 1,26 1,6 2,6 2,4 4,4 4,2 6,2";
  const inner = "7,4 25,4 25,5 27,5 27,7 28,7 28,25 27,25 27,27 25,27 25,28 7,28 7,27 5,27 5,25 4,25 4,7 5,7 5,5 7,5";
  return (
    <svg className="hof-frame hof-frame-px" width={size} height={size} viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden>
      <defs>
        <MetalGrad id={m} rank={rank} />
      </defs>
      <polygon points={outer} fill={`url(#${m})`} />
      <polygon points={inner} fill="#191433" fillOpacity="0.82" />
      <rect x="7" y="4" width="18" height="1" fill="#fff" fillOpacity="0.35" />
      <rect x="4" y="7" width="1" height="18" fill="#fff" fillOpacity="0.25" />
      <rect x="2" y="15" width="1" height="2" fill="#191433" fillOpacity="0.5" />
      <rect x="29" y="15" width="1" height="2" fill="#191433" fillOpacity="0.5" />
      <g className="hof-px-gem">
        <rect x="15" y="0" width="2" height="1" fill="#1c2f9e" />
        <rect x="14" y="1" width="4" height="1" fill="#4f86ff" />
        <rect x="13" y="2" width="6" height="1" fill="#2f5ce0" />
        <rect x="14" y="3" width="4" height="1" fill="#1c2f9e" />
        <rect x="15" y="4" width="2" height="1" fill="#14217a" />
        <rect x="15" y="1" width="1" height="1" fill="#e6f2ff" />
      </g>
    </svg>
  );
}

/** 2안 육각 보석 액자: 금속 육각 테두리, 위 꼭짓점에 사파이어, 아래 작은 보석 */
function HexFrame({ rank, size }: { rank: 1 | 2 | 3; size: number }) {
  const m = `hofHx${rank}`;
  const g = `hofHxG${rank}`;
  const hex = (r: number) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = ((-90 + i * 60) * Math.PI) / 180;
      return `${(50 + Math.cos(a) * r).toFixed(1)},${(52 + Math.sin(a) * r).toFixed(1)}`;
    }).join(" ");
  return (
    <svg className="hof-frame" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <MetalGrad id={m} rank={rank} />
        <SapphireGrad id={g} />
      </defs>
      <polygon points={hex(43)} fill="#191433" fillOpacity="0.78" stroke={`url(#${m})`} strokeWidth="6" strokeLinejoin="round" />
      <polygon points={hex(36)} fill="none" stroke={`url(#${m})`} strokeWidth="1.2" strokeOpacity="0.7" />
      <polygon points="50,0 59,9 50,19 41,9" fill={`url(#${g})`} stroke="#0e1650" strokeWidth="1" />
      <polygon points="50,2 54,9 50,9" fill="#fff" fillOpacity="0.55" />
      <polygon points="50,90 55,95 50,100 45,95" fill={`url(#${g})`} stroke="#0e1650" strokeWidth="0.8" />
    </svg>
  );
}

/** 3안 빛 링: 두 겹 금속 고리와 눈금, 빛 하나가 고리를 돈다 */
function RingFrame({ rank, size }: { rank: 1 | 2 | 3; size: number }) {
  const m = `hofRg${rank}`;
  const ticks = Array.from({ length: 24 }, (_, i) => i * 15);
  return (
    <svg className="hof-frame" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <MetalGrad id={m} rank={rank} />
        <radialGradient id={`${m}s`}>
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="43" fill="#191433" fillOpacity="0.7" stroke={`url(#${m})`} strokeWidth="4" />
      <circle cx="50" cy="50" r="37" fill="none" stroke={`url(#${m})`} strokeWidth="1" strokeOpacity="0.6" />
      {ticks.map((t) => (
        <rect key={t} x="49.4" y="7.5" width="1.2" height={t % 90 === 0 ? 5 : 2.5} fill={`url(#${m})`} transform={`rotate(${t} 50 50)`} />
      ))}
      <g className="hof-orbit">
        <circle cx="50" cy="7" r="7" fill={`url(#${m}s)`} />
        <circle cx="50" cy="7" r="2" fill="#fff" />
      </g>
    </svg>
  );
}

/** 4안 방패 문장: 금속 테두리 방패와 아래 순위 리본 */
function ShieldFrame({ rank, size }: { rank: 1 | 2 | 3; size: number }) {
  const m = `hofSh${rank}`;
  const label = rank === 1 ? "1ST" : rank === 2 ? "2ND" : "3RD";
  return (
    <svg className="hof-frame" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <MetalGrad id={m} rank={rank} />
      </defs>
      <path d="M50 3 L89 15 L89 48 C89 72 72 88 50 97 C28 88 11 72 11 48 L11 15 Z" fill="#191433" fillOpacity="0.8" stroke={`url(#${m})`} strokeWidth="5" strokeLinejoin="round" />
      <path d="M50 10 L82 20 L82 48 C82 67 68 81 50 89 C32 81 18 67 18 48 L18 20 Z" fill="none" stroke={`url(#${m})`} strokeWidth="1" strokeOpacity="0.6" />
      <polygon points="2,80 14,74 86,74 98,80 92,86 98,92 86,90 14,90 2,92 8,86" fill={`url(#${m})`} stroke="#3a2a10" strokeOpacity="0.5" strokeWidth="0.8" />
      <text x="50" y="86" textAnchor="middle" fontSize="11" fontWeight="900" fill="#2a1d08" fillOpacity="0.85" letterSpacing="1">
        {label}
      </text>
    </svg>
  );
}

/** 5안 상장 리본(로제트): 주름진 둥근 리본과 아래로 늘어진 두 꼬리 */
function RosetteFrame({ rank, size }: { rank: 1 | 2 | 3; size: number }) {
  const m = `hofRo${rank}`;
  const tail = rank === 1 ? "#d64545" : rank === 2 ? "#4f86ff" : "#3fae7a";
  const petals = Array.from({ length: 22 }, (_, i) => (i * 360) / 22);
  return (
    <svg className="hof-frame hof-frame-rosette" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <MetalGrad id={m} rank={rank} />
      </defs>
      <polygon points="36,78 28,116 36,110 42,118 48,82" fill={tail} stroke="#000" strokeOpacity="0.25" strokeWidth="0.8" />
      <polygon points="64,78 72,116 64,110 58,118 52,82" fill={tail} stroke="#000" strokeOpacity="0.25" strokeWidth="0.8" />
      {petals.map((a) => (
        <circle key={a} cx="50" cy="8" r="7.5" fill={`url(#${m})`} stroke="#000" strokeOpacity="0.18" strokeWidth="0.6" transform={`rotate(${a} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="38" fill={`url(#${m})`} />
      <circle cx="50" cy="50" r="33" fill="#191433" fillOpacity="0.85" stroke="#fff" strokeOpacity="0.35" strokeWidth="1" />
    </svg>
  );
}

function Frame({ rank, size }: { rank: 1 | 2 | 3; size: number }) {
  const k = frameKind();
  if (k === 1) return <PixelFrame rank={rank} size={size} />;
  if (k === 2) return <HexFrame rank={rank} size={size} />;
  if (k === 3) return <RingFrame rank={rank} size={size} />;
  if (k === 4) return <ShieldFrame rank={rank} size={size} />;
  if (k === 5) return <RosetteFrame rank={rank} size={size} />;
  return <Laurel size={size} />;
}

const STARS = Array.from({ length: 22 }, (_, i) => ({
  left: (i * 37) % 100,
  top: (i * 53) % 92,
  delay: (i % 7) * 0.45,
  size: i % 5 === 0 ? 3 : 2,
}));

/**
 * 마일리지: 쓸 수 있는 정수만 보이고 누르면(펼치면) 쌓인 소수 둘째 자리까지 (제작자 2026-11-10 '소수점 이하는 안 보이게, 클릭하면 소수점 숫자가 보이게').
 * 소수는 내림 (정수 부분만 쓸 수 있어서 반올림하면 쓸 수 있는 양보다 커 보인다)
 */
function Mile({ m, full }: { m: number; full: boolean }) {
  const cents = Math.floor(Math.round(m * 1e6) / 1e4);
  const whole = Math.floor(cents / 100);
  const dec = cents - whole * 100;
  return (
    <>
      {whole.toLocaleString()}
      {full && dec > 0 && <span className="hof-dec">.{String(dec).padStart(2, "0").replace(/0$/, "")}</span>}
    </>
  );
}

/** 그 사람의 기부 (누르면 펼침) */
function Gifts({ lines }: { lines: GiftLine[] }) {
  if (!lines.length) return null;
  return (
    <ul className="hof-gifts">
      {lines.map((l) => (
        <li key={l.id}>
          <span className="hof-g-day">{dayText(l.at)}</span>
          <span className="hof-g-name">
            {l.label}
            {l.from === "rent" && <em>장비대여</em>}
            {l.place && l.place !== "keep" && <em>{PLACE_NAME[l.place]}</em>}
          </span>
          <span className="hof-g-val">
            {goldText(Math.abs(l.gold))}
            <b>💎{l.dia > 0 ? "+" : ""}{mileText(l.dia)}</b>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Podium({ rank, h, me, open, onToggle }: { rank: 1 | 2 | 3; h: HallRow; me: boolean; open: boolean; onToggle: () => void }) {
  return (
    <button className={`hof-pod hof-pod-${rank}` + (me ? " hof-me" : "") + (open ? " hof-open" : "")} onClick={onToggle}>
      {rank === 1 && (
        <>
          <span className="hof-beam" aria-hidden />
          <span className="hof-crown" aria-hidden>
            👑
          </span>
        </>
      )}
      <span className="hof-pod-face">
        {rank === 1 && <HeroHalo />}
        <Frame rank={rank} size={rank === 1 ? 92 : 70} />
        <span className="hof-pod-pic">
          <Face h={h} size={rank === 1 ? 54 : 40} />
        </span>
      </span>
      <b className="hof-pod-name">
        <Nick name={h.name} />
      </b>
      <span className="hof-pod-mile">
        <i>💎</i>
        <Mile m={h.earned} full={open} />
      </span>
      <small className="hof-pod-sub">
        {goldText(h.gold)} · {h.count}건
      </small>
      <span className="hof-plinth">
        <span className="hof-plinth-num">{rank}</span>
        <span className="hof-sheen" aria-hidden />
      </span>
    </button>
  );
}

export function HallPage({ me }: { me: Me }) {
  const [period, setPeriod] = useEntryState<"all" | "month">("hof.period", "all");
  const [open, setOpen] = useState<string | null>(null);
  // 누적 마일리지 칸과 아래 내 순위 줄은 눌러서 소수까지
  const [totalFull, setTotalFull] = useState(false);
  const [mineFull, setMineFull] = useState(false);
  const { data: real, error } = useAsync(
    useCallback(() => fetchHall(period), [period]),
    `hall:${period}`,
  );
  if (!real) return <Loading error={error} />;
  // 기부가 아직 없으면 길드원 닉네임으로 만든 예시 (서버로 가지 않음)
  const sample = !real.hall.length;
  const data = sample ? sampleHall(period) : real;
  const mine = (h: HallRow) => !sample && (h.names.includes(me.id) || h.name === me.id);
  const linesOf = (h: HallRow) => data.lines.filter((l) => h.names.includes(l.who));
  const toggle = (name: string) => setOpen((o) => (o === name ? null : name));
  const top = data.hall.slice(0, 3);
  const myRank = data.hall.findIndex(mine);
  const openRow = top.find((h) => h.name === open);

  return (
    <>
      <TopBar title="명예의 전당" />
      <nav className="sub-tabs">
        {(["all", "month"] as const).map((p) => (
          <button
            key={p}
            className={"sub-tab" + (period === p ? " sub-tab-on" : "")}
            onClick={() => {
              setPeriod(p);
              setOpen(null);
            }}
          >
            {p === "all" ? "전체" : "이번 달"}
          </button>
        ))}
      </nav>

      <section className="hof-stage">
        <span className="hof-rays" aria-hidden />
        <span className="hof-spot hof-spot-l" aria-hidden />
        <span className="hof-spot hof-spot-r" aria-hidden />
        {STARS.map((s, i) => (
          <i key={i} className="hof-star" style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s` }} aria-hidden />
        ))}
        <div className="hof-total">
          <button type="button" className="hof-total-mile" aria-pressed={totalFull} onClick={() => setTotalFull((v) => !v)}>
            <small>누적 마일리지</small>
            <b>
              💎 <Mile m={data.total.earned} full={totalFull} />
            </b>
          </button>
          <span>
            <small>기부 가치</small>
            <b>{goldText(data.total.gold)}</b>
          </span>
          <span>
            <small>기부자</small>
            <b>{data.total.people}명</b>
          </span>
          {sample && <i className="sample-tag hof-sample">예시</i>}
        </div>
        {!top.length ? (
          <p className="hof-empty">아직 기부가 없어요</p>
        ) : (
          <div className="hof-podium">
            {top[1] && <Podium rank={2} h={top[1]} me={mine(top[1])} open={open === top[1].name} onToggle={() => toggle(top[1].name)} />}
            <Podium rank={1} h={top[0]} me={mine(top[0])} open={open === top[0].name} onToggle={() => toggle(top[0].name)} />
            {top[2] && <Podium rank={3} h={top[2]} me={mine(top[2])} open={open === top[2].name} onToggle={() => toggle(top[2].name)} />}
          </div>
        )}
      </section>
      {openRow && (
        <div className="hof-drawer">
          <Gifts lines={linesOf(openRow)} />
        </div>
      )}

      <ol className="hof-list">
        {data.hall.slice(3).map((h, i) => (
          <li key={h.name} className={"hof-row" + (i < 7 ? " hof-plaque" : "") + (mine(h) ? " hof-me" : "") + (open === h.name ? " hof-open" : "")}>
            <button className="hof-row-btn" onClick={() => toggle(h.name)}>
              <span className="hof-rank">{i + 4}</span>
              <span className="hof-row-face">
                <Face h={h} size={26} />
              </span>
              <span className="hof-row-name">
                <Nick name={h.name} />
                <small>
                  {goldText(h.gold)} · {h.count}건
                </small>
              </span>
              <span className="hof-row-mile">
                💎 <Mile m={h.earned} full={open === h.name} />
              </span>
              {i < 7 && <span className="hof-sheen" aria-hidden />}
            </button>
            {open === h.name && <Gifts lines={linesOf(h)} />}
          </li>
        ))}
      </ol>

      {myRank >= 0 && (
        <button type="button" className="hof-mine" aria-pressed={mineFull} onClick={() => setMineFull((v) => !v)}>
          <span className="hof-mine-rank">{myRank + 1}위</span>
          <span className="hof-mine-name">
            <Nick name={data.hall[myRank].name} />
          </span>
          <span className="hof-mine-mile">
            💎 <Mile m={data.hall[myRank].earned} full={mineFull} />
          </span>
        </button>
      )}
    </>
  );
}
