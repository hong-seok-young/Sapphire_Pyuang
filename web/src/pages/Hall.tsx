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
import { PLACE_NAME, dayText, fetchHall, goldText, mileText } from "../donate";
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

const STARS = Array.from({ length: 22 }, (_, i) => ({
  left: (i * 37) % 100,
  top: (i * 53) % 92,
  delay: (i % 7) * 0.45,
  size: i % 5 === 0 ? 3 : 2,
}));

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
        <Laurel size={rank === 1 ? 92 : 70} />
        <span className="hof-pod-pic">
          <Face h={h} size={rank === 1 ? 54 : 40} />
        </span>
      </span>
      <b className="hof-pod-name">
        <Nick name={h.name} />
      </b>
      <span className="hof-pod-mile">
        <i>💎</i>
        {mileText(h.earned)}
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
  const { data, error } = useAsync(
    useCallback(() => fetchHall(period), [period]),
    `hall:${period}`,
  );
  if (!data) return <Loading error={error} />;
  const mine = (h: HallRow) => h.names.includes(me.id) || h.name === me.id;
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
          <span>
            <small>누적 마일리지</small>
            <b>💎 {mileText(data.total.earned)}</b>
          </span>
          <span>
            <small>기부 가치</small>
            <b>{goldText(data.total.gold)}</b>
          </span>
          <span>
            <small>기부자</small>
            <b>{data.total.people}명</b>
          </span>
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
              <span className="hof-row-mile">💎 {mileText(h.earned)}</span>
              {i < 7 && <span className="hof-sheen" aria-hidden />}
            </button>
            {open === h.name && <Gifts lines={linesOf(h)} />}
          </li>
        ))}
      </ol>

      {myRank >= 0 && (
        <div className="hof-mine">
          <span className="hof-mine-rank">{myRank + 1}위</span>
          <span className="hof-mine-name">
            <Nick name={data.hall[myRank].name} />
          </span>
          <span className="hof-mine-mile">💎 {mileText(data.hall[myRank].earned)}</span>
        </div>
      )}
    </>
  );
}
