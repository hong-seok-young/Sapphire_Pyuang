// 명예의 전당 (개발중, 제작자 2026-11-10 마을모금함 '마일리지 순위표, 명예의 전당' -> 퓨앙 '명예의 전당은 별도 버튼으로, 최대한 고급지고 화려하고 가장 임팩트 있게').
// 기부(기부함 확정 + 장비대여 기부)로 쌓인 마일리지 순. 1~3위 단상(빛기둥·마법진·상장 리본·왕관), 4위부터 금속 명판, 누르면 그 사람의 기부.
// 서버 functions/api/donate/hall.ts (server/donate.ts hallOfFame). 움직임은 보는 동안만 transform·opacity, 움직임 줄이기면 멈춘다
import { useCallback, useState } from "react";
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

/* ---------- 프로필 둘레: 상장 리본(로제트) (제작자 2026-11-10 '월계수 관 별로' -> 5개 안 중 '상장 리본으로, 애니메이션 고급지고 화려하게') ----------
 * 주름진 금속 꽃잎 고리(천천히 돈다)와 빛이 지나가는 금속 테, 반대로 도는 점선 고리, 숨 쉬는 빛, 흔들리는 리본 꼬리, 둘레에 반짝이는 별.
 * 1위는 뒤에 도는 빛살과 꽃잎 두 겹. 누르면(펼치면) 톡 튄다. 움직임은 transform·opacity 만, 움직임 줄이기면 멈춘다 */
const METAL: Record<1 | 2 | 3, [string, string, string]> = {
  1: ["#fff6cf", "#f2c14e", "#9a6a14"],
  2: ["#ffffff", "#c6cfe0", "#6f7a92"],
  3: ["#ffe1c6", "#d8894b", "#74401c"],
};
/** 리본 꼬리 색: 1위 빨강, 2위 파랑, 3위 초록 (밝은 쪽, 어두운 쪽) */
const TAIL: Record<1 | 2 | 3, [string, string]> = { 1: ["#ff6b6b", "#b02a2a"], 2: ["#6fa0ff", "#2a4fb8"], 3: ["#5fd39b", "#1f7a4e"] };
/** 꽃잎 둘레에서 반짝이는 별 자리 (x, y, 크기, 늦춤) */
const SPARKS: [number, number, number, number][] = [
  [12, 20, 5, 0], [90, 26, 4, 0.7], [94, 66, 5, 1.4], [8, 62, 4, 2.1], [70, 4, 3.5, 2.8], [28, 6, 3, 3.5],
];
const star = (x: number, y: number, r: number) => `M${x} ${y - r} L${x + r * 0.28} ${y - r * 0.28} L${x + r} ${y} L${x + r * 0.28} ${y + r * 0.28} L${x} ${y + r} L${x - r * 0.28} ${y + r * 0.28} L${x - r} ${y} L${x - r * 0.28} ${y - r * 0.28} Z`;

function Rosette({ rank, size }: { rank: 1 | 2 | 3; size: number }) {
  const m = `hofRo${rank}`;
  const [a, b, c] = METAL[rank];
  const [tl, td] = TAIL[rank];
  const petals = Array.from({ length: 22 }, (_, i) => (i * 360) / 22);
  return (
    <svg className={`hof-frame hof-ro hof-ro-${rank}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <linearGradient id={m} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="0.5" stopColor={b} />
          <stop offset="1" stopColor={c} />
        </linearGradient>
        <linearGradient id={`${m}t`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={td} />
          <stop offset="0.5" stopColor={tl} />
          <stop offset="1" stopColor={td} />
        </linearGradient>
        <radialGradient id={`${m}g`}>
          <stop offset="0.55" stopColor={b} stopOpacity="0.75" />
          <stop offset="1" stopColor={b} stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${m}c`}>
          <circle cx="50" cy="50" r="38" />
        </clipPath>
      </defs>
      <circle className="hof-ro-glow" cx="50" cy="50" r="58" fill={`url(#${m}g)`} />
      {rank === 1 && (
        <g className="hof-ro-rays">
          {Array.from({ length: 12 }, (_, i) => (
            <polygon key={i} points="48.5,-8 51.5,-8 50.6,30 49.4,30" fill={a} fillOpacity="0.5" transform={`rotate(${i * 30} 50 50)`} />
          ))}
        </g>
      )}
      <g className="hof-ro-tail hof-ro-tail-l">
        <polygon points="37,76 29,108 37,102 43,110 49,80" fill={`url(#${m}t)`} />
        <polygon points="37,76 33,95 41,80" fill="#fff" fillOpacity="0.25" />
      </g>
      <g className="hof-ro-tail hof-ro-tail-r">
        <polygon points="63,76 71,108 63,102 57,110 51,80" fill={`url(#${m}t)`} />
        <polygon points="63,76 67,95 59,80" fill="#000" fillOpacity="0.18" />
      </g>
      <g className="hof-ro-core">
        {rank === 1 && (
          <g className="hof-ro-petals2">
            {petals.map((p) => (
              <circle key={p} cx="50" cy="3" r="6" fill={c} fillOpacity="0.9" transform={`rotate(${p + 8} 50 50)`} />
            ))}
          </g>
        )}
        <g className="hof-ro-petals">
          {petals.map((p) => (
            <circle key={p} cx="50" cy="8" r="7.5" fill={`url(#${m})`} stroke="#000" strokeOpacity="0.18" strokeWidth="0.6" transform={`rotate(${p} 50 50)`} />
          ))}
        </g>
        <circle cx="50" cy="50" r="38" fill={`url(#${m})`} />
        <g clipPath={`url(#${m}c)`}>
          <g transform="rotate(24 50 50)">
            <rect className="hof-ro-sheen" x="-30" y="-20" width="14" height="140" fill="#fff" fillOpacity="0.55" />
          </g>
        </g>
        <circle className="hof-ro-dash" cx="50" cy="50" r="35.5" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="2.2 2.6" />
        <circle cx="50" cy="50" r="33" fill="#191433" fillOpacity="0.88" stroke="#fff" strokeOpacity="0.35" strokeWidth="1" />
      </g>
      {SPARKS.map(([x, y, r, d], i) => (
        <path key={i} className="hof-ro-spark" d={star(x, y, r)} fill="#fff" style={{ animationDelay: `${d}s` }} />
      ))}
    </svg>
  );
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
        <Rosette rank={rank} size={rank === 1 ? 92 : 70} />
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
