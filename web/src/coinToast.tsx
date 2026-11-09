// 성장코인 팝업 (2군 성장코인샵, 제작자 2026-11-09 '그냥 길드원 랭킹에서 레벨하고 겸치 입력하면 성장코인 주게, 너가 더 재밌게'):
// 길드 랭킹·내 정보에서 레벨·경험치를 저장해 새 성장코인이 생기면 아래 탭 위에 동전이 돌며 '+35' 가 0 부터 올라가고, 넘은 구간 한마디나
// 이번 주 2군 성장 순위를 보인다. 누르면 상점으로. src/auth.ts saveMyProfile 이 'sapphire:gcoin' 으로 알린다 (서버가 코인을 줄 때만: 지금은 앱개발자·테스트 계정)
import { useEffect, useRef, useState } from "react";
import { go } from "./router";
import { COIN_EVENT, RACE_EVENT, milestone } from "./gcoin";
import type { CoinGain, RaceGain } from "./gcoin";

const SHOW_MS = 5200;
/** 이번 주 1위로 올라선 순간은 더 오래, 크게 */
const KING_MS = 6000;
const MEDAL = ["🥇", "🥈", "🥉"];
const CONFETTI = ["#ffd34d", "#3fe0a0", "#ff7a9c", "#6f8fff", "#fff3b0"];

export function CoinToast() {
  const [gain, setGain] = useState<CoinGain | null>(null);
  const [shown, setShown] = useState(0);
  const [k, setK] = useState(0);
  const hide = useRef<number>();
  useEffect(() => {
    const on = (e: Event) => {
      const g = (e as CustomEvent<CoinGain>).detail;
      if (!g || !(g.gained > 0)) return;
      setGain(g);
      setK((x) => x + 1);
      window.clearTimeout(hide.current);
      hide.current = window.setTimeout(
        () => setGain(null),
        g.rank === 1 && g.prevRank !== 1 ? KING_MS : SHOW_MS,
      );
    };
    window.addEventListener(COIN_EVENT, on);
    return () => {
      window.removeEventListener(COIN_EVENT, on);
      window.clearTimeout(hide.current);
    };
  }, []);
  // 0 부터 세어 올라간다 (움직임 줄이기면 바로)
  useEffect(() => {
    if (!gain) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(gain.gained);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 700);
      setShown(Math.round(gain.gained * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gain, k]);
  if (!gain) return null;
  const king = gain.rank === 1 && gain.prevRank !== 1;
  // 처음 넘은 레벨 보너스가 있으면 그것을, 없으면 구간 한마디
  const ms = gain.milestones?.length
    ? gain.milestones[gain.milestones.length - 1]
    : null;
  const line = king
    ? "👑 이번 주 1위!"
    : ms
      ? `🎉 ${ms.name} +${ms.coin}`
      : milestone(gain.from, gain.to);
  const rank =
    gain.rank === null
      ? null
      : gain.rank <= 3
        ? `${MEDAL[gain.rank - 1]} 이번 주 ${gain.rank}위${gain.gap !== null ? ` · ${gain.rank - 1}위까지 ${gain.gap}` : ""}`
        : `이번 주 ${gain.rank}위${gain.gap !== null ? ` · 바로 위까지 ${gain.gap}` : ""}`;
  return (
    <button
      key={k}
      className={"ct" + (king ? " ct-king" : "")}
      onClick={() => {
        setGain(null);
        go("#/gcoin");
      }}
      aria-live="polite"
    >
      <span className="ct-spark" aria-hidden="true">
        {Array.from({ length: king ? 16 : 8 }, (_, i) => (
          <i
            key={i}
            style={{ ["--a" as string]: `${i * (king ? 22.5 : 45)}deg` }}
          />
        ))}
      </span>
      {king && (
        <span className="ct-confetti" aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <i
              key={i}
              style={{
                ["--x" as string]: `${(i * 37) % 100}%`,
                ["--d" as string]: `${(i % 5) * 0.12}s`,
                ["--c" as string]: CONFETTI[i % CONFETTI.length],
              }}
            />
          ))}
        </span>
      )}
      {king && (
        <span className="ct-crown" aria-hidden="true">
          👑
        </span>
      )}
      <i className="gc-coin gc-coin-big ct-coin" aria-hidden="true" />
      <span className="ct-main">
        <b className="ct-num">+{shown}</b>
        <small>성장코인 {gain.balance}</small>
        {(line || rank) && <span className="ct-line">{line ?? rank}</span>}
        {line && rank && !king && (
          <span className="ct-line ct-sub">{rank}</span>
        )}
      </span>
      {gain.step && gain.step.pct < 100 && (
        <GainBar gain={gain} step={gain.step} />
      )}
    </button>
  );
}

/**
 * 입력하는 맛 (제작자 2026-11-09 '입력하는 맛이 나게'): 저장한 만큼 경험치 막대가 차오르고, 지나는 이정표(코인이 들어오는 칸)마다
 * 차례로 금빛으로 터지며 '+4' 가 튀어 오른다. 레벨이 올랐으면 0% 부터. CSS 만으로 (채움은 scaleX, 이정표는 차오르는 때에 맞춘 지연)
 */
const FILL_MS = 1100;
function GainBar({
  gain,
  step,
}: {
  gain: CoinGain;
  step: { pct: number; coin: number };
}) {
  const lv = Math.floor(gain.to);
  const to = Math.round((gain.to - lv) * 100000) / 1000;
  const from =
    Math.floor(gain.from) === lv
      ? Math.round((gain.from - lv) * 100000) / 1000
      : 0;
  const span = Math.max(0.001, to - from);
  const marks = Array.from(
    { length: Math.round(100 / step.pct) },
    (_, i) => (i + 1) * step.pct,
  );
  return (
    <span className="ct-bar" aria-hidden="true">
      <span className="ct-bar-lv">
        {Math.floor(gain.from) < lv ? <b>UP</b> : null}Lv.{lv}
      </span>
      <span
        className="ct-bar-track"
        style={{
          ["--f" as string]: from / 100,
          ["--t" as string]: to / 100,
          ["--ms" as string]: `${FILL_MS}ms`,
        }}
      >
        <i className="ct-bar-fill" />
        {marks.map((m) => {
          const hit = m > from + 1e-6 && m <= to + 1e-6;
          return (
            <span
              key={m}
              className={
                "ct-mark" +
                (m <= from + 1e-6 ? " ct-mark-old" : hit ? " ct-mark-hit" : "")
              }
              style={{
                left: `${m}%`,
                ["--d" as string]: `${Math.round(((m - from) / span) * FILL_MS) + 250}ms`,
              }}
            >
              {hit && <em>+{step.coin}</em>}
            </span>
          );
        })}
      </span>
      <span className="ct-bar-pct">{Math.floor(to * 10) / 10}%</span>
    </span>
  );
}

/**
 * 2주 목표 선착순 팝업 (입력하는 맛): 레벨·경험치를 저장하면 달성률 막대가 저장 전 자리에서 차오르고 숫자가 올라간다.
 * 이번 저장으로 목표를 찍었으면 금빛 'N위 확정!'과 상금, 왕관(1위)과 색종이 (server/gcrace.ts raceAfter, src/auth.ts 가 'sapphire:gcrace' 로 알린다)
 */
export function RaceToast() {
  const [g, setG] = useState<RaceGain | null>(null);
  const [k, setK] = useState(0);
  const [shown, setShown] = useState(0);
  const hide = useRef<number>();
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<RaceGain>).detail;
      if (!d) return;
      setG(d);
      setK((x) => x + 1);
      window.clearTimeout(hide.current);
      hide.current = window.setTimeout(
        () => setG(null),
        d.justDone ? KING_MS : SHOW_MS,
      );
    };
    window.addEventListener(RACE_EVENT, on);
    return () => {
      window.removeEventListener(RACE_EVENT, on);
      window.clearTimeout(hide.current);
    };
  }, []);
  useEffect(() => {
    if (!g) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(g.pct);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - t0 - 250) / FILL_MS));
      setShown(g.prevPct + (g.pct - g.prevPct) * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [g, k]);
  if (!g) return null;
  const king = g.justDone;
  const up = Math.round((g.pct - g.prevPct) * 10) / 10;
  return (
    <button
      key={k}
      className={"ct ct-race" + (king ? " ct-king" : "")}
      onClick={() => {
        setG(null);
        go("#/gcoin");
      }}
      aria-live="polite"
    >
      <span className="ct-spark" aria-hidden="true">
        {Array.from({ length: king ? 16 : 8 }, (_, i) => (
          <i
            key={i}
            style={{ ["--a" as string]: `${i * (king ? 22.5 : 45)}deg` }}
          />
        ))}
      </span>
      {king && (
        <span className="ct-confetti" aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <i
              key={i}
              style={{
                ["--x" as string]: `${(i * 37) % 100}%`,
                ["--d" as string]: `${(i % 5) * 0.12}s`,
                ["--c" as string]: CONFETTI[i % CONFETTI.length],
              }}
            />
          ))}
        </span>
      )}
      {king && g.rank === 1 && (
        <span className="ct-crown" aria-hidden="true">
          👑
        </span>
      )}
      <span className="ct-race-pct" aria-hidden="true">
        {king ? "🏁" : `${Math.floor(shown * 10) / 10}%`}
      </span>
      <span className="ct-main">
        {king ? (
          <>
            <b className="ct-num">{g.rank}위 확정!</b>
            <small>
              목표 Lv.{g.target} 달성
              {g.coins > 0 ? ` · 성장코인 +${g.coins}` : ""}
            </small>
          </>
        ) : (
          <>
            <b className="ct-num ct-num-s">
              달성률 {up > 0 ? `+${up}%` : `${g.pct}%`}
            </b>
            <small>
              목표 Lv.{g.target} · 지금 {g.rank}위
            </small>
          </>
        )}
      </span>
      <span className="ct-bar" aria-hidden="true">
        <span className="ct-bar-lv">Lv.{g.fromLevel}</span>
        <span
          className="ct-bar-track"
          style={{
            ["--f" as string]: g.prevPct / 100,
            ["--t" as string]: g.pct / 100,
            ["--ms" as string]: `${FILL_MS}ms`,
          }}
        >
          <i className="ct-bar-fill" />
          {Array.from(
            { length: Math.max(0, g.target - g.fromLevel - 1) },
            (_, i) => {
              const at = ((i + 1) / (g.target - g.fromLevel)) * 100;
              const hit = at > g.prevPct + 1e-6 && at <= g.pct + 1e-6;
              return (
                <span
                  key={i}
                  className={
                    "ct-mark" +
                    (at <= g.prevPct + 1e-6
                      ? " ct-mark-old"
                      : hit
                        ? " ct-mark-hit"
                        : "")
                  }
                  style={{
                    left: `${at}%`,
                    ["--d" as string]: `${Math.round(((at - g.prevPct) / Math.max(0.001, g.pct - g.prevPct)) * FILL_MS) + 250}ms`,
                  }}
                >
                  {hit && <em>Lv.{g.fromLevel + i + 1}</em>}
                </span>
              );
            },
          )}
        </span>
        <span className="ct-bar-pct">🏁{g.target}</span>
      </span>
    </button>
  );
}
