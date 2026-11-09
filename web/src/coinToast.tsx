// 성장코인 팝업 (2군 성장코인샵, 제작자 2026-11-09 '그냥 길드원 랭킹에서 레벨하고 겸치 입력하면 성장코인 주게, 너가 더 재밌게'):
// 길드 랭킹·내 정보에서 레벨·경험치를 저장해 새 성장코인이 생기면 아래 탭 위에 동전이 돌며 '+35' 가 0 부터 올라가고, 넘은 구간 한마디나
// 이번 주 2군 성장 순위를 보인다. 누르면 상점으로. src/auth.ts saveMyProfile 이 'sapphire:gcoin' 으로 알린다 (서버가 코인을 줄 때만: 지금은 앱개발자·테스트 계정)
import { useEffect, useRef, useState } from "react";
import { go } from "./router";
import { COIN_EVENT, milestone } from "./gcoin";
import type { CoinGain } from "./gcoin";

const SHOW_MS = 4200;
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
      hide.current = window.setTimeout(() => setGain(null), g.rank === 1 && g.prevRank !== 1 ? KING_MS : SHOW_MS);
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
  const ms = gain.milestones?.length ? gain.milestones[gain.milestones.length - 1] : null;
  const line = king ? "👑 이번 주 1위!" : ms ? `🎉 ${ms.name} +${ms.coin}` : milestone(gain.from, gain.to);
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
          <i key={i} style={{ ["--a" as string]: `${i * (king ? 22.5 : 45)}deg` }} />
        ))}
      </span>
      {king && (
        <span className="ct-confetti" aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{ ["--x" as string]: `${(i * 37) % 100}%`, ["--d" as string]: `${(i % 5) * 0.12}s`, ["--c" as string]: CONFETTI[i % CONFETTI.length] }} />
          ))}
        </span>
      )}
      {king && <span className="ct-crown" aria-hidden="true">👑</span>}
      <i className="gc-coin gc-coin-big ct-coin" aria-hidden="true" />
      <span className="ct-main">
        <b className="ct-num">+{shown}</b>
        <small>성장코인 {gain.balance}</small>
        {(line || rank) && <span className="ct-line">{line ?? rank}</span>}
        {line && rank && !king && <span className="ct-line ct-sub">{rank}</span>}
      </span>
    </button>
  );
}
