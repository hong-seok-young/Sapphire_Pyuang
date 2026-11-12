// 명예의 전당 (개발중, 제작자 2026-11-10 마을모금함 '마일리지 순위표, 명예의 전당' -> 퓨앙 '명예의 전당은 별도 버튼으로, 최대한 고급지고 화려하고 가장 임팩트 있게').
// 기부(기부함 확정 + 장비대여 기부)로 쌓인 마일리지 순. 1~3위 단상(빛기둥·마법진·상장 리본·왕관), 4위부터 금속 명판, 누르면 그 사람의 기부.
// 기부함은 '전체 · 이번 달' 오른쪽 단추로 들어간다 (GiveButton). 서버 functions/api/donate/hall.ts (server/donate.ts hallOfFame). 움직임은 보는 동안만 transform·opacity, 움직임 줄이기면 멈춘다
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
import type { Wiki } from "../types";
import { GiftIconOf, GiftTitleOf } from "./GiftName";

function Face({ h, size, rank }: { h: HallRow; size: number; rank: number }) {
  if (h.avatar) return <img className="growth-face" src={avatarUrl(h.name, h.avatar)} alt="" style={{ maxWidth: size, maxHeight: size }} draggable={false} />;
  if (h.job) return <JobEmblem job={h.job} size={size} />;
  return <GemFace size={Math.round(size * 0.92)} rank={rank} />;
}

/* 사진·직업이 없는 사람(앱에 없는 기부자)의 자리: 보석 (제작자 2026-11-10 선물 상자 '별론데' -> 초안 5개 중 보석 -> 브릴리언트 컷 -> '고급진 초호화 보석 느낌의 실제 다이아로'
 * -> '오로라는 빼고 1 2 3위를 다른 색상으로 애니메이션 잔뜩 넣어서 알아서 색상 배치'). 1위 사파이어 + 다이아 헤일로, 2위 에메랄드, 3위 핑크 다이아, 4위부터 화이트 다이아.
 * 움직임(transform·opacity 만, 움직임 줄이기면 멈춘다): 보석이 살짝 떠 있고, 빛 띠가 지나가고, 면이 차례로 반짝이고, 둘레에 별이 돈다.
 * 1·2·3위는 뒤에 숨 쉬는 빛과 도는 빛살, 1위는 헤일로 다이아가 천천히 돌며 차례로 반짝인다. 4위부터는 빛 띠만 (줄이 많아서) */
type Lux = { shades: string[]; fire?: boolean; halo?: boolean; edge: string; glow: string };
const SAPPHIRE: Lux = { shades: ["#d6e7ff", "#7aa8ff", "#2f62e6", "#1a3aa8", "#0a1a5e"], edge: "#bcd6ff", glow: "#4f86ff" };
const EMERALD: Lux = { shades: ["#dcfbea", "#72e3ab", "#1faf70", "#137a4c", "#0a3f28"], edge: "#c9f6df", glow: "#3fd28a" };
/** 4위부터: 흰 다이아, 1·2·3위만 유색 (제작자 2026-11-10 '4위부터를 흰색으로 하고 123위를 유색으로') */
const WHITE: Lux = { shades: ["#ffffff", "#eef7ff", "#cfe0f5", "#9fb4d4", "#6a80a8"], fire: true, edge: "#ffffff", glow: "#dfeeff" };
const LUX: Record<1 | 2 | 3, Lux> = {
  1: { ...SAPPHIRE, halo: true },
  2: { ...EMERALD },
  3: { shades: ["#fff2f8", "#ffc6df", "#f584b6", "#c4467f", "#7a1f4a"], edge: "#ffe0ee", glow: "#ff8fc0" },
};
const T = [30, 40, 50, 60, 70];
const G = [6, 22, 38, 50, 62, 78, 94];
const pt = (x: number, y: number) => `${x},${y}`;
/** 브릴리언트 컷 면 [점들, 밝기 0(밝음)~4(어두움)] */
const FACETS: [string, number][] = (() => {
  const f: [string, number][] = [];
  // 테이블 (위에서 비스듬히 본 윗면)
  f.push([[pt(30, 28), pt(38, 18), pt(62, 18), pt(70, 28)].join(" "), 1]);
  f.push([[pt(38, 18), pt(50, 23), pt(62, 18)].join(" "), 0]);
  f.push([[pt(30, 28), pt(50, 23), pt(70, 28)].join(" "), 2]);
  // 크라운
  const crown = [0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1];
  const tris: number[][][] = [];
  tris.push([[G[0], 42], [T[0], 28], [G[1], 42]]);
  for (let i = 0; i < 4; i++) {
    tris.push([[G[i + 1], 42], [T[i], 28], [T[i + 1], 28]]);
    tris.push([[G[i + 1], 42], [T[i + 1], 28], [G[i + 2], 42]]);
  }
  tris.push([[G[5], 42], [T[4], 28], [G[6], 42]]);
  tris.forEach((t, i) => f.push([t.map(([x, y]) => pt(x, y)).join(" "), crown[i % crown.length]]));
  // 거들
  f.push([[pt(6, 42), pt(94, 42), pt(94, 45), pt(6, 45)].join(" "), 0]);
  // 파빌리언
  const pav = [3, 1, 4, 2, 3, 1];
  for (let i = 0; i < 6; i++) {
    const m = (G[i] + G[i + 1]) / 2;
    f.push([[pt(G[i], 45), pt(m, 45), pt(50, 92)].join(" "), pav[i]]);
    f.push([[pt(m, 45), pt(G[i + 1], 45), pt(50, 92)].join(" "), pav[(i + 3) % 6]]);
  }
  return f;
})();
const OUTLINE = [pt(6, 42), pt(30, 28), pt(38, 18), pt(62, 18), pt(70, 28), pt(94, 42), pt(94, 45), pt(50, 92), pt(6, 45)].join(" ");
const FIRE = ["#ff6b8b", "#ffd166", "#7cf2c2", "#6fb8ff", "#c79bff"];
const SPARK = "M0,-7 L1.4,-1.4 L7,0 L1.4,1.4 L0,7 L-1.4,1.4 L-7,0 L-1.4,-1.4 Z";
const RAYS = Array.from({ length: 12 }, (_, i) => i * 30);
const HALO_DOTS = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2;
  return [60 + Math.cos(a) * 54, 60 + Math.sin(a) * 54];
});
/** 보석 svg 의 viewBox [x, y, 너비] (정사각형): 1위는 헤일로 안쪽에 작게, 2·3위는 둘레 빛 자리를 두고, 줄은 꽉 차게 */
const GEM_BOX: Record<"halo" | "top" | "row", [number, number, number]> = { halo: [-15.2, -13, 130.4], top: [-10, -5, 120], row: [-4, 1, 108] };
/** 빛 띠가 보석 밖으로 나가지 않게 자르는 모양 (보석 svg 칸의 %) */
const clipOf = ([vx, vy, vw]: [number, number, number]) =>
  `polygon(${OUTLINE.split(" ")
    .map((p) => {
      const [x, y] = p.split(",").map(Number);
      return `${(((x - vx) / vw) * 100).toFixed(1)}% ${(((y - vy) / vw) * 100).toFixed(1)}%`;
    })
    .join(", ")})`;
/** 반짝이 자리 [왼쪽 %, 위 %, 크기 %, 늦춤 초, 색 쓸지] */
const SPARKS_AT: Record<"halo" | "top", [number, number, number, number, boolean][]> = {
  halo: [[24, 24, 20, 0, false], [78, 36, 15, 0.6, false], [50, 82, 13, 1.2, false], [84, 78, 11, 1.8, true], [14, 62, 10, 2.4, true]],
  top: [[20, 22, 20, 0, false], [80, 30, 15, 0.6, false], [52, 70, 12, 1.2, false], [12, 58, 10, 1.8, true]],
};

function GemSvg({ v, box }: { v: Lux; box: [number, number, number] }) {
  return (
    <svg className="hof-lux-gem" viewBox={`${box[0]} ${box[1]} ${box[2]} ${box[2]}`}>
      {FACETS.map(([p, k], i) => (
        <polygon key={i} points={p} fill={v.shades[k]} />
      ))}
      {v.fire && FACETS.filter((_, i) => i % 4 === 1).map(([p], i) => <polygon key={`f${i}`} points={p} fill={FIRE[i % FIRE.length]} opacity={0.35} />)}
      {FACETS.map(([p], i) => (
        <polygon key={`e${i}`} points={p} fill="none" stroke={v.edge} strokeOpacity={0.55} strokeWidth={0.6} strokeLinejoin="round" />
      ))}
      <polygon points={OUTLINE} fill="none" stroke={v.shades[4]} strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

/** 보석은 가만히 있는 svg 하나로 그리고, 움직이는 것(빛 띠, 반짝이, 빛살, 둘레 빛, 헤일로 돌기, 떠 있기)은 그 위아래의 따로 된 층이 transform·opacity 로만 움직인다.
 * svg 안에서 움직이면 매 프레임 svg 전체를 다시 그려 폰에서 버벅였다 (CPU 4배 느리게 31fps -> 층으로 나눈 뒤 아래 시험) */
function GemFace({ size, rank }: { size: number; rank: number }) {
  const kind = rank === 1 ? "halo" : rank <= 3 ? "top" : "row";
  const v = rank <= 3 ? LUX[rank as 1 | 2 | 3] : WHITE;
  const box = GEM_BOX[kind];
  const sheen = (
    <span className="hof-lux-layer hof-lux-sheen-clip" style={{ clipPath: clipOf(box) }}>
      <span className="hof-lux-sheen" style={kind === "row" ? { animationDuration: "4.6s", animationDelay: `${(rank % 5) * 0.7}s` } : undefined} />
    </span>
  );
  if (kind === "row")
    return (
      <span className="hof-lux" style={{ width: size, height: size }}>
        <GemSvg v={v} box={box} />
        {sheen}
      </span>
    );
  return (
    <span className="hof-lux" style={{ width: size, height: size }}>
      <svg className="hof-lux-layer hof-lux-rays" viewBox="0 0 120 120" aria-hidden>
        {RAYS.map((a) => (
          <rect key={a} x={58.6} y={6} width={2.8} height={30} rx={1.4} fill={v.glow} opacity={0.35} transform={`rotate(${a} 60 60)`} />
        ))}
      </svg>
      <span className="hof-lux-layer hof-lux-glow" style={{ background: `radial-gradient(circle, ${v.glow}d9 0%, ${v.glow}00 68%)` }} />
      {kind === "halo" && (
        <svg className="hof-lux-layer hof-lux-halo" viewBox="0 0 120 120" aria-hidden>
          <defs>
            <radialGradient id="hofHaloDot" cx="35%" cy="30%" r="70%">
              <stop offset="0" stopColor="#fff" />
              <stop offset="0.6" stopColor="#dfeaf7" />
              <stop offset="1" stopColor="#8fa3c4" />
            </radialGradient>
          </defs>
          <circle cx={60} cy={60} r={54} fill="none" stroke="#e7ecf5" strokeWidth={3} />
          {HALO_DOTS.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={5.2} fill="url(#hofHaloDot)" stroke="#fff" strokeWidth={0.8} />
          ))}
        </svg>
      )}
      <span className="hof-lux-layer hof-lux-float">
        <GemSvg v={v} box={box} />
        {sheen}
      </span>
      {SPARKS_AT[kind].map(([l, t, s, d, tint], i) => (
        <span key={i} className="hof-lux-spark" style={{ left: `${l}%`, top: `${t}%`, width: `${s}%`, height: `${s}%`, animationDelay: `${d}s` }}>
          <svg viewBox="-7 -7 14 14">
            <path d={SPARK} fill={tint ? v.glow : "#fff"} />
          </svg>
        </span>
      ))}
    </span>
  );
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
function Gifts({ lines, wiki }: { lines: GiftLine[]; wiki: Wiki | null }) {
  if (!lines.length) return null;
  return (
    <ul className="hof-gifts">
      {lines.map((l) => (
        <li key={l.id}>
          <span className="hof-g-day">{dayText(l.at)}</span>
          <GiftIconOf label={l.label} wiki={wiki} size={18} />
          <span className="hof-g-name">
            <GiftTitleOf label={l.label} wiki={wiki} />
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
          <Face h={h} size={rank === 1 ? 54 : 40} rank={rank} />
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

/** 도트 선물 상자 (10 x 10 칸) */
const GIFT_PX: [number, number, number, number, string][] = [
  // 리본 매듭
  [2, 0, 2, 1, "#ff5a8a"], [6, 0, 2, 1, "#ff5a8a"], [1, 1, 1, 2, "#ff5a8a"], [4, 1, 2, 2, "#ff2e6b"], [8, 1, 1, 2, "#ff5a8a"], [2, 2, 2, 1, "#c8205a"], [6, 2, 2, 1, "#c8205a"],
  // 뚜껑과 상자
  [0, 3, 10, 2, "#ffd55a"], [0, 3, 10, 1, "#fff0b0"], [1, 5, 8, 5, "#f0a52a"], [1, 9, 8, 1, "#b8701a"],
  // 세로 리본
  [4, 3, 2, 7, "#ff2e6b"], [4, 3, 1, 7, "#ff7aa2"],
];
function GiftPx() {
  return (
    <svg className="hof-give-ic" viewBox="0 0 10 10" shapeRendering="crispEdges" aria-hidden>
      {GIFT_PX.map(([x, y, w, h, c], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={c} />
      ))}
    </svg>
  );
}

/**
 * '전체 · 이번 달' 오른쪽 기부함 단추 (제작자 2026-11-12 '기부함을 명예의 전당 안에', '이번 달 우측에 기부함 버튼 편입, 사람들이 잘 인지할 수 있게, 애니메이션 등'):
 * 금빛 단추에 빛이 지나가고, 둘레로 고리가 퍼지고, 선물 상자가 통통 뛰며 별이 반짝인다 (transform·opacity 만, 움직임 줄이기면 멈춤)
 */
function GiveButton() {
  return (
    <a className="hof-give" href="#/donate">
      <span className="hof-give-ping" aria-hidden />
      <span className="hof-give-face">
        <span className="hof-give-sheen" aria-hidden />
        <GiftPx />
        <b>기부함</b>
        <i className="hof-give-star hof-give-star-1" aria-hidden />
        <i className="hof-give-star hof-give-star-2" aria-hidden />
        <i className="hof-give-star hof-give-star-3" aria-hidden />
      </span>
    </a>
  );
}

export function HallPage({ me, wiki }: { me: Me; wiki: Wiki | null }) {
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
        <GiveButton />
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
          <Gifts lines={linesOf(openRow)} wiki={wiki} />
        </div>
      )}

      <ol className="hof-list">
        {data.hall.slice(3).map((h, i) => (
          <li key={h.name} className={"hof-row" + (i < 7 ? " hof-plaque" : "") + (mine(h) ? " hof-me" : "") + (open === h.name ? " hof-open" : "")}>
            <button className="hof-row-btn" onClick={() => toggle(h.name)}>
              <span className="hof-rank">{i + 4}</span>
              <span className="hof-row-face">
                <Face h={h} size={26} rank={i + 4} />
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
            {open === h.name && <Gifts lines={linesOf(h)} wiki={wiki} />}
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
