import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "./auth";
import type { Me } from "./auth";
import { useBackClose } from "./backClose";
import { Nick } from "./kakao";
import { inFloat } from "./platform";
import { useTutorial } from "./tutorialState";
import { Fx, PALETTE, pick } from "./birthdayFx";
import { Garland } from "./birthdayGarland";

/**
 * 생일 스티커 (제작자 요청 2026-11-07: '마을모금함이 길마인데 11월 8일 생일이야, 자정부터 자정까지 24시간 동안 웹 화면에
 * 저 몸짱과 마을모금함과 낼름낼름낼름 말풍선만 잘라서 스티커처럼, 드래그해서 움직일 수도 있고 클릭하면 해피 버스데이 투 유 텍스트가
 * 하나씩, 하트와 폭죽 등등 막 랜덤으로').
 * 그림은 제작자가 준 게임 스샷에서 몸짱 동상·캐릭터·말풍선만 오린 것 (비공개 자료 이미지/생일, 자료/scripts/make_birthday_sticker.py ->
 * /data/birthday, 로그인한 길드원에게만). 화면 어디서나 떠 있고, 끌면 옮겨지고(이 기기에 자리 기억), 누르면 노래 한 줄과 하트·폭죽·풍선·반짝이가 랜덤으로.
 * 그날 한국 시간 0시부터 24시간만 보인다. 앱개발자는 미리 본다. 게임과 상관없는 꾸밈이라 게임 안전 규칙에 맞는다.
 * 효과는 초안 다섯 안을 모두 섞고 (누를 때마다 다섯 안을 한 번씩 돌아가며, 같은 안이 잇따르지 않게), 10번째 누를 때마다 생일 메인 폭죽
 * (제작자 2026-11-07 '12345 다 섞고, 생축 메인 폭죽은 10번 누를 때마다 터트려 줘')
 */
export interface Birthday {
  key: string;
  who: string;
  start: number;
  end: number;
  base: string;
  bubble: string;
  /** 그림 세로 / 가로 */
  ratio: number;
  /** 말풍선 꼬리 끝 (그림 안 비율): 말풍선이 튈 때 기준점 */
  tip: [number, number];
}

export const BIRTHDAYS: Birthday[] = [
  {
    key: "village-2026",
    who: "마을모금함",
    start: Date.parse("2026-11-08T00:00:00+09:00"),
    end: Date.parse("2026-11-09T00:00:00+09:00"),
    // 그림을 바꾸면 ?v= 를 올린다 (/data 그림은 폰에 하루 저장된다)
    base: "/data/birthday/bday-base.png?v=3",
    bubble: "/data/birthday/bday-bubble.png?v=3",
    ratio: 503 / 600,
    tip: [0.4155, 0.3373],
  },
];

/** 지금 보일 생일 (앱개발자는 시작 전에도 미리 본다) */
function current(me: Me, now: number): Birthday | null {
  return BIRTHDAYS.find((b) => now < b.end && (now >= b.start || me.role === "developer")) ?? null;
}

const POS_KEY = "sapphire.bday.pos";
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 스티커 폭: 좁은 폰은 화면의 44%, 넓으면 176px */
const widthOf = (vw: number) => Math.round(Math.min(176, Math.max(136, vw * 0.44)));
const RIBBON = 14;

interface Pos {
  x: number;
  y: number;
}

function loadPos(): { fx: number; fy: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? "null") as { fx: number; fy: number } | null;
    return v && Number.isFinite(v.fx) && Number.isFinite(v.fy) ? v : null;
  } catch {
    return null;
  }
}

// ---------- 효과: 다섯 안 (제작자 2026-11-07 '최대한 화려하고 성대하게, 폭죽 막 터트리고, 5개 안 움짤로') ----------
interface Line {
  id: number;
  x: number;
  y: number;
  text: string;
  hue: number;
  cls: string;
  /** '… 님 생일 축하해요' 줄: 더 천천히 올라간다 */
  keep?: boolean;
  /** 화면 위 밖까지 올라갈 거리(px)와 걸리는 시간(초) */
  rise: number;
  dur: number;
}
interface Pop {
  id: number;
  x: number;
  y: number;
  text: string;
  cls: string;
  /** 콤보 외침의 단계 (1~20)와 아래 작은 글 ('STAGE 7', '300 COMBO') */
  lv?: number;
  sub?: string;
}
interface Banner {
  id: number;
  text: string;
  cls: string;
}
/** 노래 줄 바탕색 (분홍, 금, 사파이어, 보라, 민트) */
const HUES = [335, 38, 228, 280, 165];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
let seq = 0;

interface TapCtx {
  fx: Fx;
  /** 누른 곳 */
  x: number;
  y: number;
  /** 스티커 가운데와 위 */
  cx: number;
  cy: number;
  top: number;
  vw: number;
  vh: number;
  /** 안마다 조금 더 크게 터지는 때 (다섯 줄 노래의 네 번째 줄) */
  finale: boolean;
  combo: number;
  pop: (text: string, x: number, y: number, cls: string) => void;
  banner: (text: string, cls: string, ms: number) => void;
}
interface Variant {
  name: string;
  /** 스티커 둘레에 늘 도는 꾸밈 (보고 있는 동안) */
  idle: string;
  line: string;
  tap: (c: TapCtx) => void;
}
const pat = (xs: string[]) => pick(xs);
const two = () => [pick(PALETTE), pick(PALETTE)];

export const VARIANTS: Variant[] = [
  {
    name: "불꽃 대축제",
    idle: "bday-idle-gold",
    line: "bday-line-gold",
    tap: ({ fx, x, y, vw, vh, finale }) => {
      const n = finale ? 9 : 3 + Math.floor(rnd(0, 3));
      for (let i = 0; i < n; i++)
        fx.rocket(rnd(0.1, 0.9) * vw, vh + 10, rnd(0.12, 0.88) * vw, rnd(0.1, 0.42) * vh, pat(["peony", "ring", "willow", "crossette", "star", "double"]), two(), i * 0.22 + rnd(0, 0.1), finale ? 1.25 : 1);
      fx.explode(x, y, "peony", ["#ffd27a", "#ff4d8d"], 0.45);
      if (finale) for (let i = 0; i < 3; i++) fx.explode(rnd(0.2, 0.8) * vw, rnd(0.08, 0.2) * vh, "willow", ["#ffd27a"], 1.3, 1.6 + i * 0.35);
    },
  },
  {
    name: "하트 폭발",
    idle: "bday-idle-hearts",
    line: "bday-line-pink",
    tap: ({ fx, x, y, cx, cy, vw, vh, finale }) => {
      fx.explode(cx, cy - 30, "heart", ["#ff4d8d"], 1.15);
      fx.ring(cx, cy, "#ff7aa8", 360);
      fx.ring(cx, cy, "#ffd1e3", 260, 0.12);
      fx.hearts(x, y, 22);
      for (let i = 0; i < 2; i++) fx.rocket(rnd(0.15, 0.85) * vw, vh + 10, rnd(0.2, 0.8) * vw, rnd(0.12, 0.35) * vh, "heart", ["#ff4d8d"], 0.25 + i * 0.3);
      if (finale) {
        fx.heartRain(70);
        for (let i = 0; i < 4; i++) fx.rocket(rnd(0.1, 0.9) * vw, vh + 10, rnd(0.15, 0.85) * vw, rnd(0.1, 0.3) * vh, "heart", ["#ff4d8d"], 0.6 + i * 0.25, 1.3);
      }
    },
  },
  {
    name: "색종이 대포",
    idle: "bday-idle-candy",
    line: "bday-line-candy",
    tap: ({ fx, x, y, vw, vh, finale, banner }) => {
      fx.confetti(-10, vh + 10, -1.05, 0.28, 90, [700, 1050]);
      fx.confetti(vw + 10, vh + 10, -Math.PI + 1.05, 0.28, 90, [700, 1050]);
      fx.confetti(x, y, -Math.PI / 2, 1.1, 34, [220, 460]);
      fx.flash(x, y, "#ffffff", 20, 200);
      fx.rocket(rnd(0.2, 0.8) * vw, vh + 10, rnd(0.2, 0.8) * vw, rnd(0.12, 0.3) * vh, pat(["peony", "double", "ring"]), two(), 0.2);
      banner("HAPPY BIRTHDAY", "bday-bunting", 5200);
      if (finale) {
        fx.confettiRain(170);
        for (let i = 0; i < 4; i++) fx.rocket(rnd(0.1, 0.9) * vw, vh + 10, rnd(0.15, 0.85) * vw, rnd(0.1, 0.35) * vh, pat(["peony", "star", "crossette"]), two(), 0.4 + i * 0.25);
      }
    },
  },
  {
    name: "8비트 아케이드",
    idle: "bday-idle-pixel",
    line: "bday-line-pixel",
    tap: ({ fx, x, y, vw, vh, finale, pop, banner }) => {
      fx.explode(x, y, "pixel", PALETTE, 0.8);
      for (let i = 0; i < 2; i++) fx.rocket(rnd(0.15, 0.85) * vw, vh + 10, rnd(0.15, 0.85) * vw, rnd(0.12, 0.38) * vh, "pixel", PALETTE, 0.15 + i * 0.25);
      fx.shake();
      pop("+1 ♥", x, y - 26, "bday-score");
      banner("HAPPY BIRTHDAY", finale ? "bday-rainbow bday-rainbow-big" : "bday-rainbow", 2300);
      if (finale) for (let i = 0; i < 6; i++) fx.rocket(rnd(0.1, 0.9) * vw, vh + 10, rnd(0.1, 0.9) * vw, rnd(0.1, 0.4) * vh, "pixel", PALETTE, 0.3 + i * 0.18, 1.3);
    },
  },
  {
    name: "피날레 파티",
    idle: "bday-idle-rays",
    line: "bday-line-karaoke",
    tap: ({ fx, cx, top, vw, vh, finale, banner }) => {
      fx.balloons(finale ? 14 : 6);
      fx.fountain(cx, top + 14, 1.3);
      for (let i = 0; i < 2; i++) fx.rocket(rnd(0.15, 0.85) * vw, vh + 10, rnd(0.15, 0.85) * vw, rnd(0.1, 0.35) * vh, pat(["peony", "double", "willow"]), two(), 0.3 + i * 0.35);
      if (finale) {
        banner("생일 축하해요", "bday-finale", 3800);
        fx.confettiRain(140, 0.4);
        for (let i = 0; i < 12; i++)
          fx.rocket(rnd(0.08, 0.92) * vw, vh + 10, rnd(0.1, 0.9) * vw, rnd(0.08, 0.4) * vh, pat(["peony", "ring", "willow", "star", "crossette", "double"]), two(), 0.2 + i * 0.2, 1.2);
      }
    },
  },
];
const FX_KEY = "sapphire.bday.fx";
/** 이 기기에 1~5 를 적어 두면 그 안만 (초안 다시 보기), 아니면 다섯 안을 섞는다 */
function onlyVariant(): number | null {
  try {
    const n = Number(localStorage.getItem(FX_KEY));
    if (Number.isInteger(n) && n >= 1 && n <= VARIANTS.length) return n - 1;
  } catch {
    /* 섞기 */
  }
  return null;
}
/** 다섯 안을 한 번씩 섞은 차례 (앞 차례의 마지막과 같은 안으로 시작하지 않게) */
function shuffled(last: number): number[] {
  const order = VARIANTS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order[0] === last) order.push(order.shift()!);
  return order;
}

/** 생일 메인 폭죽: 10번째 누를 때마다 */
const FINALE_EVERY = 10;
/**
 * 아주 빠른 연타에 폰이 버거우면 멈추지 않게 (제작자 2026-11-08 '엄청 빠르게 누르니까 멈췄대' -> '효과 줄이지 마'): 효과는 그대로 두고,
 * 화면이 실제로 끊기기 시작할 때만(Fx.quality 가 OK 아래) 그만큼 띄엄띄엄 낸다. 잘 도는 폰에서는 아무것도 줄지 않는다.
 * 아래 값은 끊길 때 쓰는 간격의 기준 (끊길수록 길게)
 */
const SMOOTH = 0.6;
const GRAND_GAP = 7000;
const FX_GAP = 160;
const HIT_GAP = 140;
const LINE_GAP = 230;
/** 지금 품질(q)에서 그 효과를 낼 수 있는지: 잘 돌면 늘, 끊기면 gap/q 마다 */
const ready = (q: number, since: number, gap: number) => q >= SMOOTH || since >= gap / Math.max(q, 0.25);
function liteFinale({ fx, cx, cy, vw, vh, banner }: TapCtx) {
  fx.shake();
  fx.flash(cx, cy, "#ffffff", 50, 300);
  fx.ring(cx, cy, "#ffd27a", 400);
  fx.ring(cx, cy, "#ff7aa8", 300, 0.12);
  banner("생일 축하해요", "bday-finale", 4600);
  for (let i = 0; i < 3; i++) fx.rocket(rnd(0.1, 0.9) * vw, vh + 10, rnd(0.15, 0.85) * vw, rnd(0.08, 0.35) * vh, pat(ALL_PATTERNS), two(), i * 0.2, 1.1);
}
const ALL_PATTERNS = ["peony", "ring", "willow", "crossette", "star", "double", "heart", "pixel"];
function grandFinale({ fx, cx, cy, top, vw, vh, banner }: TapCtx) {
  fx.shake();
  fx.flash(cx, cy, "#ffffff", 70, 380);
  fx.ring(cx, cy, "#ffd27a", 460);
  fx.ring(cx, cy, "#ff7aa8", 360, 0.15);
  fx.ring(cx, cy, "#7ab8ff", 280, 0.3);
  fx.explode(cx, cy - 30, "heart", ["#ff4d8d"], 1.35);
  banner("생일 축하해요", "bday-finale", 4600);
  fx.confetti(-10, vh + 10, -1.05, 0.28, 110, [720, 1100]);
  fx.confetti(vw + 10, vh + 10, -Math.PI + 1.05, 0.28, 110, [720, 1100]);
  fx.fountain(cx, top + 14, 1.6);
  fx.balloons(12, 0.3);
  fx.heartRain(50, 0.5);
  fx.confettiRain(150, 0.8);
  // 하늘을 덮는 불꽃: 3초 동안 이어서
  for (let i = 0; i < 18; i++)
    fx.rocket(rnd(0.06, 0.94) * vw, vh + 10, rnd(0.08, 0.92) * vw, rnd(0.06, 0.42) * vh, pat(ALL_PATTERNS), two(), 0.15 + i * 0.17, 1.25);
  // 마지막에 금빛 버드나무 불꽃
  for (let i = 0; i < 4; i++) fx.explode(rnd(0.15, 0.85) * vw, rnd(0.06, 0.2) * vh, "willow", ["#ffd27a"], 1.45, 3.3 + i * 0.3);
}

export function BirthdaySticker({ me }: { me: Me }) {
  const [now, setNow] = useState(() => Date.now());
  const tut = useTutorial();
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const day = current(me, now);
  if (!day || inFloat || tut) return null;
  return <Sticker day={day} me={me.id} live={now >= day.start} />;
}

// ---------- 콤보 (제작자 2026-11-07 '스티커 누를 때마다 애니메이션 엄청 화려하게, 최대 콤보 순위도 어딘가에 나열') ----------
/** 이 안에 다시 누르면(스티커나 풍선) 콤보가 이어진다 */
const COMBO_MS = 1300;
/** 콤보가 커질수록 누를 때 터지는 것도 커진다 */
const tierOf = (n: number) => (n >= 50 ? 4 : n >= 30 ? 3 : n >= 15 ? 2 : n >= 5 ? 1 : 0);
/** 콤보 외침 20단계: 5콤보마다 한 단계 (제작자 2026-11-07 '레전드 어썸 이런 거 20단계로 나눠 줘'). 100 넘게는 50마다 'N COMBO!' */
const SHOUTS = [
  "NICE!", "GOOD!", "GREAT!", "COOL!", "SUPER!", "AWESOME!", "AMAZING!", "EXCELLENT!", "WONDERFUL!", "FANTASTIC!",
  "FEVER!", "INCREDIBLE!", "UNSTOPPABLE!", "RAMPAGE!", "MONSTER!", "LEGEND!", "MYTHIC!", "DIVINE!", "IMMORTAL!", "GODLIKE!",
];
const SHOUT_EVERY = 5;
/**
 * 100 콤보 다음부터는 100 마다 아래에서 아무 낱말이나 (제작자 2026-11-08 '굿럭 이런 거도 100 단위로 임의 단어로 막 10만 개까지 뜨게').
 * 바로 앞과 같은 낱말은 안 나온다. 10만 콤보까지
 */
const BIG_SHOUTS = [
  "GOOD LUCK!", "BRAVO!", "JACKPOT!", "PERFECT!", "SUPERB!", "MARVELOUS!", "SPECTACULAR!", "PHENOMENAL!", "OUTSTANDING!", "BRILLIANT!",
  "EPIC!", "HEROIC!", "MAJESTIC!", "GLORIOUS!", "LEGENDARY!", "ULTRA!", "HYPER!", "MEGA!", "GIGA!", "TERA!",
  "COSMIC!", "GALACTIC!", "STELLAR!", "SUPERNOVA!", "INFINITE!", "ETERNAL!", "ABSOLUTE!", "ULTIMATE!", "SUPREME!", "INSANE!",
  "CRAZY!", "WILD!", "BEAST MODE!", "ON FIRE!", "UNSTOPPABLE!", "CHAMPION!", "MVP!", "KING!", "QUEEN!", "BOSS!",
  "WOW!", "OMG!", "BOOM!", "KABOOM!", "UNREAL!", "MIRACLE!", "MAGIC!", "LUCKY!", "SAPPHIRE!", "HAPPY BIRTHDAY!",
  "CONGRATS!", "CHEERS!", "PARTY TIME!", "SO GOOD!", "AMAZING!", "UNBELIEVABLE!", "GODLIKE!", "MYTHICAL!", "TITAN!", "DRAGON!",
  "대박!", "미쳤다!", "전설!", "신의 손!", "생일 축하!", "손가락 장인!", "광클의 신!", "축하해요!", "최고!", "멈추지 마!",
];
const SHOUT_MAX = 100_000;
/** 외침 글자 폭 (글자 크기 배수): 한글은 1, 나머지는 0.62 쯤 */
const emLen = (t: string) => [...t].reduce((k, c) => k + (/[가-힣]/.test(c) ? 1 : 0.62), 0);
/** 외침 글자 크기와 가운데 자리 (320px 화면에서도 안으로) */
function shoutFit(word: string, lv: number, cx: number, vw: number) {
  const em = emLen(word);
  const fs = Math.min(22 + lv * 0.7, (vw - 24) / em);
  const half = Math.min(vw / 2 - 6, (em * fs) / 2 + 8);
  return Math.min(Math.max(cx, half), vw - half);
}
let lastBig = "";
function shoutOf(n: number): { word: string; lv: number; sub: string } | null {
  if (n < SHOUT_EVERY || n % SHOUT_EVERY) return null;
  const lv = n / SHOUT_EVERY;
  if (lv <= SHOUTS.length) return { word: SHOUTS[lv - 1], lv, sub: `STAGE ${lv}` };
  if (n % 100 || n > SHOUT_MAX) return null;
  let word = pick(BIG_SHOUTS);
  if (word === lastBig) word = BIG_SHOUTS[(BIG_SHOUTS.indexOf(word) + 1) % BIG_SHOUTS.length];
  lastBig = word;
  return { word, lv: SHOUTS.length, sub: `${n.toLocaleString("ko-KR")} COMBO` };
}
const STAR_COLORS = ["#fff27a", "#ffd27a", "#ff7aa8", "#7ab8ff", "#7ee2a8", "#c58bff"];
/** 누를 때 스티커에서 튀어 나가는 별 (누를 때마다 각도·거리가 조금씩 다르게) */
function starsOf(seed: number, tier: number) {
  const n = 10 + tier * 3;
  return Array.from({ length: n }, (_, k) => {
    const r = Math.sin(seed * 97.13 + k * 12.9898) * 43758.5453;
    const f = r - Math.floor(r);
    return { a: (360 / n) * k + f * 20, d: 60 + f * 40 + tier * 18, c: STAR_COLORS[(k + seed) % STAR_COLORS.length], dl: f * 0.08 };
  });
}

interface Board {
  top: { id: string; best: number }[];
  mine: { best: number; rank: number | null } | null;
  total: number;
  /** 끊긴 콤보 이어서 하기 (운영이 넣어 준 것, 한 번) */
  resume?: number | null;
}
/**
 * 한 번 그린 효과를 다시 돌린다 (지우고 새로 그리지 않아 다시 그리는 일 없이 움직임만, 제작자 2026-11-08 '많이 누를수록 렉이 심해진대, 최적화해').
 * 누를 때마다 큰 빛살·고리·화면 가장자리 빛·콤보 숫자를 새로 만들면 폰이 그때마다 그림을 다시 그려서 느려졌다
 */
function replay(el: Element | null, subtree = false) {
  if (!el) return;
  for (const a of el.getAnimations({ subtree })) {
    a.currentTime = 0;
    a.play();
  }
}
/** 콤보 중 실시간 저장: 내 최고를 넘은 뒤 25 콤보·3초마다 (앱이 멈추거나 꺼져도 기록이 남게, 제작자 2026-11-08 '끊김 대비해서 실시간 저장도') */
const LIVE_SAVE_STEP = 25;
const LIVE_SAVE_MS = 3000;
/** 이어서 하기를 누른 뒤 첫 누름까지 기다려 주는 때 */
const RESUME_GRACE = 6000;

/** 생일 콤보 순위 창 */
function ComboRank({ day, me, board, onClose }: { day: Birthday; me: string; board: Board | null; onClose: () => void }) {
  useBackClose(true, onClose);
  const inTop = board?.top.some((r) => r.id === me);
  const medal = (k: number) => (k === 0 ? "🥇" : k === 1 ? "🥈" : k === 2 ? "🥉" : `${k + 1}`);
  return createPortal(
    <div className="bday-rank-back" onClick={onClose}>
      <div className="bday-rank" role="dialog" aria-label="생일 콤보 순위" onClick={(e) => e.stopPropagation()}>
        <div className="bday-rank-head">
          <b>🏆 생일 콤보 순위</b>
          <button type="button" className="bday-rank-x" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="bday-rank-sub">{day.who} 님 생일 · 1.3초 안에 이어 누르기</div>
        {!board ? (
          <div className="bday-rank-empty">불러오는 중…</div>
        ) : !board.top.length ? (
          <div className="bday-rank-empty">아직 기록이 없어요</div>
        ) : (
          <ol className="bday-rank-list">
            {board.top.map((r, k) => (
              <li key={r.id} className={r.id === me ? "mine" : undefined}>
                <span className="bday-rank-r">{medal(k)}</span>
                <span className="bday-rank-n">
                  <Nick name={r.id} />
                </span>
                <span className="bday-rank-c">
                  {r.best}
                  <small>COMBO</small>
                </span>
              </li>
            ))}
          </ol>
        )}
        {board?.mine && !inTop && (
          <div className="bday-rank-me">
            <span className="bday-rank-r">{board.mine.rank ?? "-"}</span>
            <span className="bday-rank-n">내 기록</span>
            <span className="bday-rank-c">
              {board.mine.best}
              <small>COMBO</small>
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * 콤보 순위 전광판: 아래 탭 바로 위 한 줄에 3위까지 (제작자 2026-11-07 '순위 전광판도 맨 아래 5개 버튼 바로 윗줄에' -> '순위는 3위까지 전광판 띄워 주고 연타하면 맨 위에').
 * 홈에서는 '배치 편집·날씨·버전' 줄 위에. 연타하는 동안은 맨 위로 올라가 지금 콤보를 넣은 실시간 순위 (현수막이 떨어져 아래 줄에 쌓이므로).
 * 한 줄에 다 들어가면 가운데 그대로, 넘치면 흐른다. 누르면 순위 창
 */
interface TickRow {
  id: string;
  best: number;
  me: boolean;
}
function liveRows(board: Board | null, me: string, live: number | null): TickRow[] {
  const top = board?.top ?? [];
  if (live == null) return top.map((r) => ({ ...r, me: r.id === me }));
  // 연타 중: 지금 콤보가 내 최고보다 크면 그 값으로 다시 줄 세운다 (같으면 먼저 올린 사람이 위)
  const mine = Math.max(board?.mine?.best ?? 0, top.find((r) => r.id === me)?.best ?? 0, live);
  const rows = top.filter((r) => r.id !== me).map((r) => ({ ...r, me: false }));
  const at = rows.findIndex((r) => r.best < mine);
  rows.splice(at < 0 ? rows.length : at, 0, { id: me, best: mine, me: true });
  return rows;
}
function ComboTicker({ board, me, home, live, onOpen }: { board: Board | null; me: string; home: boolean; live: number | null; onOpen: () => void }) {
  const medal = ["🥇", "🥈", "🥉"];
  const rows = liveRows(board, me, live);
  const top = rows.slice(0, 3);
  const myAt = rows.findIndex((r) => r.me);
  const box = useRef<HTMLSpanElement>(null);
  const one = useRef<HTMLSpanElement>(null);
  const [run, setRun] = useState(false);
  const body = top.length ? (
    <>
      {top.map((r, k) => (
        <span key={r.id} className={"bday-tk-row" + (r.me && live != null ? " bday-tk-me" : "")}>
          {medal[k]} {r.id} <b>{r.best}</b>
        </span>
      ))}
      {live != null && myAt >= 3 && (
        <span className="bday-tk-row bday-tk-me">
          나 <b>{live}</b> · {myAt + 1}위
        </span>
      )}
    </>
  ) : (
    <span className="bday-tk-row">{live != null ? `나 ${live}콤보 · 1위 도전 중` : "아직 기록이 없어요 · 스티커를 이어 눌러 1위에 도전해 보세요"}</span>
  );
  // 한 줄에 다 들어가는지 (넘치면 흐르게). 글이 바뀔 때만 잰다 (연타 중 매번 재면 무겁다)
  const sig = `${top.map((r) => `${r.id}:${r.best}`).join("|")}|${live ?? ""}|${myAt}|${home}`;
  useLayoutEffect(() => {
    const b = box.current;
    const o = one.current;
    // 흐를 때는 앞뒤 여백(42px)을 빼고 잰다 (짧아지면 다시 가운데 그대로)
    if (b && o) setRun(o.scrollWidth - (run ? 30 : 0) > b.clientWidth + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, run]);
  return createPortal(
    <button
      type="button"
      className={"bday-ticker" + (live != null ? " bday-ticker-top" : home ? " bday-ticker-home" : "")}
      onClick={onOpen}
      aria-label="생일 콤보 순위 보기"
    >
      <span className="bday-ticker-tag">{live != null ? "🔥 LIVE" : "🏆 순위"}</span>
      <span ref={box} className={"bday-ticker-box" + (run ? "" : " bday-ticker-still")}>
        {run ? (
          <span className="bday-ticker-run" style={{ animationDuration: `${Math.max(8, (one.current?.scrollWidth ?? 300) / 45)}s` }}>
            <span ref={one}>{body}</span>
            <span aria-hidden>{body}</span>
          </span>
        ) : (
          <span ref={one} className="bday-ticker-one">
            {body}
          </span>
        )}
      </span>
    </button>,
    document.body,
  );
}

function Sticker({ day, me, live }: { day: Birthday; me: string; live: boolean }) {
  const [vw, setVw] = useState(() => window.innerWidth);
  const [vh, setVh] = useState(() => window.innerHeight);
  const w = widthOf(vw);
  const h = Math.round(w * day.ratio) + RIBBON;
  const clamp = (p: Pos): Pos => ({
    x: Math.min(Math.max(p.x, 4 - w * 0.15), vw - w * 0.85),
    y: Math.min(Math.max(p.y, 4), vh - h - 4),
  });
  const place = (): Pos => {
    const saved = loadPos();
    if (saved) return clamp({ x: saved.fx * (vw - w), y: saved.fy * (vh - h) });
    // 처음: 오른쪽 아래, 아래 탭 위
    return clamp({ x: vw - w - 8, y: vh - h - 84 });
  };
  const [pos, setPos] = useState<Pos>(place);
  const [taps, setTaps] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [pops, setPops] = useState<Pop[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  /** '생일 축하해요' 큰 띠: 다시 눌러도 정해진 시간 그대로 (제작자 2026-11-07 '또 누르면 바로 사라지게 하지 말고 일정 시간 띄워 줘') */
  const [finale, setFinale] = useState<{ id: number; out: boolean } | null>(null);
  const finaleT = useRef<number[]>([]);
  const finaleOn = useRef(false);
  /** 맨 위 'HAPPY BIRTHDAY 마을모금함' 현수막 (누를수록 터지고 떨어져 아래에 쌓이고, 연타가 멈추면 하나씩 다시 걸린다) */
  const garlandEl = useRef<HTMLDivElement>(null);
  const garland = useRef<Garland | null>(null);
  /** 연타 중 순위를 제친 것 (제작자 2026-11-07 '순위 제치면 순위 제쳤다고 뜨게') */
  const [pass, setPass] = useState<{ id: number; name: string; extra: number; rank: number } | null>(null);
  const passed = useRef(new Set<string>());
  /** 이어서 하기를 눌렀다 (단추를 숨긴다) */
  const [resumed, setResumed] = useState(false);
  /** 다시 돌리는 효과들 (누를 때마다 새로 만들지 않는다) */
  const hitEl = useRef<HTMLSpanElement>(null);
  const bodyEl = useRef<HTMLDivElement>(null);
  const edgeEl = useRef<HTMLElement>(null);
  const cbEl = useRef<HTMLDivElement>(null);
  /** 이번 콤보를 시작할 때의 내 최고, 이번 콤보에서 서버에 남긴 수, 마지막 실시간 저장 때 */
  const startBest = useRef(0);
  const savedN = useRef(0);
  const lastSave = useRef(0);
  const boardAt = useRef(0);
  const [hitTier, setHitTier] = useState(0);
  const [cb, setCb] = useState<{ n: number; key: number } | null>(null);
  const [result, setResult] = useState<{ n: number; best: boolean; prev: number; rank: number | null; key: number } | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const boardRef = useRef<Board | null>(null);
  boardRef.current = board;
  const [rankOpen, setRankOpen] = useState(false);
  const only = useRef(onlyVariant()).current;
  const bag = useRef<number[]>([]);
  const lastV = useRef(-1);
  const nextVariant = (): Variant => {
    if (only != null) return VARIANTS[only];
    if (!bag.current.length) bag.current = shuffled(lastV.current);
    lastV.current = bag.current.shift()!;
    return VARIANTS[lastV.current];
  };
  /** 노래 줄 모양은 마지막에 터진 안의 것 */
  const curVariant = () => VARIANTS[only ?? Math.max(0, lastV.current)];
  /** 스티커 둘레 꾸밈: 마지막에 터진 안의 것, 안 누르는 동안은 7초마다 다음 안으로 */
  const [idle, setIdle] = useState(() => VARIANTS[only ?? Math.floor(Math.random() * VARIANTS.length)].idle);
  const tapCount = useRef(0);
  const fx = useRef<Fx | null>(null);
  /** 빠른 연타에서 효과를 덜어 내는 때 재기 (performance.now) */
  const lastHit = useRef(0);
  const lastFx = useRef(0);
  const lastGrand = useRef(-1e9);
  const lastTap = useRef(0);
  const combo = useRef(0);
  const comboT = useRef(0);
  const swallow = useRef(0);
  const [dragging, setDragging] = useState(false);
  const press = useRef<{ x: number; y: number; px: number; py: number; moved: boolean; id: number } | null>(null);
  const lyric = useRef(0);
  const lastLine = useRef<{ y: number; t: number; speed: number }>({ y: 0, t: -1e9, speed: 0 });
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    if (only != null) return;
    let k = 0;
    const t = window.setInterval(() => {
      if (document.hidden) return;
      k++;
      setIdle((cur) => VARIANTS[(VARIANTS.findIndex((v) => v.idle === cur) + 1 + (k % 2)) % VARIANTS.length].idle);
    }, 7000);
    return () => window.clearInterval(t);
  }, [only, taps]);
  useEffect(() => {
    const f = new Fx();
    f.mount();
    fx.current = f;
    const g = garlandEl.current ? new Garland(garlandEl.current, `HAPPY BIRTHDAY ${day.who}`, () => (reduced() ? null : fx.current)) : null;
    garland.current = g;
    return () => {
      g?.destroy();
      garland.current = null;
      f.destroy();
      finaleT.current.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(comboT.current);
    };
  }, []);
  useEffect(() => {
    const onResize = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // 화면 크기가 바뀌면 화면 안으로
  useEffect(() => {
    setPos((p) => clamp(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vw, vh, w]);
  // 내 최고 콤보와 순위 (콤보가 끝났을 때 최고 기록인지 알려고)
  const loadBoard = () => {
    boardAt.current = Date.now();
    return api<Board>(`/api/bday?key=${encodeURIComponent(day.key)}`)
      .then(setBoard)
      .catch(() => {});
  };
  useEffect(() => {
    void loadBoard();
    // 전광판: 보고 있는 동안 3분마다 새 순위 (모두가 자주 부르면 무료 요청 한도라 길게)
    const t = window.setInterval(() => {
      if (!document.hidden) void loadBoard();
    }, 180_000);
    return () => window.clearInterval(t);
    // 0시가 되면 다시 받는다 (그 전 미리 보기 기록은 빠진다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.key, live]);
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const home = hash === "" || hash === "#" || hash === "#/" || hash.startsWith("#/?");

  const save = (p: Pos) => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ fx: p.x / Math.max(1, vw - w), fy: p.y / Math.max(1, vh - h) }));
    } catch {
      /* 저장이 막힌 브라우저: 이번만 */
    }
  };

  const lyrics = [
    "Happy birthday to you",
    "Happy birthday to you",
    `Happy birthday dear ${day.who}`,
    "Happy birthday to you",
    `${day.who} 님 생일 축하해요`,
  ];

  const pop = (t: string, x: number, y: number, cls: string, ms = 1400, lv?: number, sub?: string) => {
    const it: Pop = { id: ++seq, x: lv ? x : Math.min(Math.max(x, 60), vw - 60), y, text: t, cls, lv, sub };
    setPops((ps) => [...ps.slice(-8), it]);
    window.setTimeout(() => setPops((ps) => ps.filter((q) => q.id !== it.id)), ms);
  };
  /** '생일 축하해요' 띠: 떠 있으면 그대로 두고 시간만 늘린다 */
  const showFinale = (ms: number) => {
    finaleT.current.forEach((t) => window.clearTimeout(t));
    finaleOn.current = true;
    setBanner(null);
    setFinale((f) => (f && !f.out ? f : { id: ++seq, out: false }));
    finaleT.current = [
      window.setTimeout(() => setFinale((f) => (f ? { ...f, out: true } : f)), ms - 600),
      window.setTimeout(() => {
        finaleOn.current = false;
        setFinale(null);
      }, ms),
    ];
  };

  /** 콤보 하나 더 (스티커나 풍선을 누를 때) */
  function bump(x: number, y: number) {
    const now = Date.now();
    combo.current = now - lastTap.current < COMBO_MS ? combo.current + 1 : 1;
    lastTap.current = now;
    const n = combo.current;
    window.clearTimeout(comboT.current);
    comboT.current = window.setTimeout(() => endCombo(n), COMBO_MS);
    if (n >= 2) {
      setCb((c) => ({ n, key: c?.key ?? ++seq }));
      replay(cbEl.current);
    }
    if (n === 1) {
      passed.current = new Set();
      startBest.current = boardRef.current?.mine?.best ?? 0;
      savedN.current = 0;
      // 연타를 시작할 때 순위를 새로 (추월을 맞게 알리려고, 20초에 한 번까지)
      if (now - boardAt.current > 20_000) void loadBoard();
    }
    garland.current?.hit(n);
    checkPass(n);
    // 실시간 저장: 내 최고를 넘었으면 25 콤보·3초마다 (끊겨도 여기까지는 남는다)
    if (n >= 3 && n > startBest.current && n - savedN.current >= LIVE_SAVE_STEP && now - lastSave.current >= LIVE_SAVE_MS) saveLive(n);
    const s = shoutOf(n);
    const p = posRef.current;
    if (s) {
      // 단계가 오를수록 크게 (긴 낱말은 화면 폭 안으로)
      pop(s.word, shoutFit(s.word, s.lv, p.x + w / 2, vw), Math.max(80, p.y - 50), "bday-shout" + (s.lv >= 11 ? " bday-shout-hot" : "") + (s.lv >= 16 ? " bday-shout-top" : ""), 1700, s.lv, s.sub);
      const f = fx.current;
      if (f && !reduced()) {
        const k = 0.8 + s.lv * 0.03;
        if (s.lv >= 4) f.shake();
        f.ring(p.x + w / 2, p.y + h / 2, "#ffd27a", 360 * k);
        f.ring(p.x + w / 2, p.y + h / 2, "#ff7aa8", 280 * k, 0.12);
        f.explode(p.x + w / 2, p.y + h / 2 - 20, s.lv >= 16 ? pick(["double", "star", "crossette"]) : pick(["star", "peony", "ring"]), PALETTE, 0.75 + s.lv * 0.025);
        f.confetti(p.x + w / 2, p.y + h / 2, -Math.PI / 2, 1.4, 24 + s.lv * 2, [260, 560]);
        if (s.lv >= 10) f.explode(Math.min(Math.max(p.x + w / 2 + rnd(-90, 90), 40), vw - 40), Math.max(90, p.y - 60), "willow", PALETTE, 0.6, 0.15);
      }
    } else if (n >= 15 && fx.current && !reduced()) {
      // 콤보가 이어지는 동안은 누른 곳에서도 작은 불꽃
      fx.current.explode(x, y, pick(["star", "ring", "pixel"]), STAR_COLORS, 0.45);
    }
    return n;
  }
  /** 지금 콤보로 내 위 사람을 제쳤으면 알린다 (그 사람을 처음 넘는 순간 한 번) */
  function checkPass(n: number) {
    const b = boardRef.current;
    if (!b) return;
    const myPrev = b.mine?.best ?? 0;
    const myIdx = b.top.findIndex((r) => r.id === me);
    const above = (myIdx >= 0 ? b.top.slice(0, myIdx) : b.top.filter((r) => r.best >= myPrev)).filter((r) => r.id !== me);
    const newly = above.filter((r) => r.best < n && !passed.current.has(r.id));
    if (!newly.length) return;
    newly.forEach((r) => passed.current.add(r.id));
    const rank = 1 + b.top.filter((r) => r.id !== me && r.best >= n).length;
    const it = { id: ++seq, name: newly[0].id, extra: newly.length - 1, rank };
    setPass(it);
    window.setTimeout(() => setPass((q) => (q?.id === it.id ? null : q)), 2200);
    const f = fx.current;
    if (f && !reduced()) {
      const y = 96;
      f.explode(vw / 2, y, rank === 1 ? "double" : "star", rank === 1 ? ["#ffd27a", "#fff27a"] : ["#ffd27a", "#ff7aa8"], rank === 1 ? 0.9 : 0.6);
      f.ring(vw / 2, y, "#ffe08a", 260);
    }
  }
  /** 콤보가 끝나면 (1.3초 동안 안 누르면) 결과를 보이고, 내 최고보다 크면 서버에 남긴다 */
  function saveLive(n: number) {
    lastSave.current = Date.now();
    const before = savedN.current;
    savedN.current = n;
    api<Board>("/api/bday?live=1", "POST", { key: day.key, combo: n })
      .then((b) => {
        // 콤보 중에는 순위만 새로 (내 최고는 이번 콤보 시작 때 값으로 견준다)
        setBoard(b);
      })
      .catch(() => {
        if (savedN.current === n) savedN.current = before;
      });
  }
  function endCombo(n: number) {
    setCb(null);
    // 연타가 멈추면 떨어진 현수막이 하나씩 날아가 다시 걸린다
    garland.current?.end();
    if (n < 3) return;
    const prev = startBest.current;
    const best = n > prev;
    const key = ++seq;
    setResult({ n, best, prev, rank: boardRef.current?.mine?.rank ?? null, key });
    window.setTimeout(() => setResult((r) => (r?.key === key ? null : r)), 3000);
    // 최고 기록은 서버에 남긴다. 인터넷이 잠깐 끊겨도 놓치지 않게 몇 번 더 보낸다 (못 남기면 알린다)
    const send = (left: number) =>
      api<Board>("/api/bday", "POST", { key: day.key, combo: n })
        .then((b) => {
          setBoard(b);
          setResult((r) => (r?.key === key ? { ...r, rank: b.mine?.rank ?? null } : r));
        })
        .catch(() => {
          if (left > 0) window.setTimeout(() => void send(left - 1), (4 - left) * 2500);
          else pop("콤보 기록을 저장하지 못했어요", vw / 2, 120, "bday-popword", 2600);
        });
    if (best && n > savedN.current) void send(3);
    else if (best) setResult((r) => (r?.key === key ? { ...r, rank: boardRef.current?.mine?.rank ?? null } : r));
    savedN.current = 0;
  }
  const bumpRef = useRef(bump);
  bumpRef.current = bump;
  const popRef = useRef(pop);
  popRef.current = pop;

  // 콤보 중에 앱을 닫거나 다른 앱으로 가면 (폰이 화면을 끊기 전에) 지금 콤보를 바로 남긴다 (제작자 2026-11-08 '11700 까지 눌렀다가 멈춰서 사라졌대')
  useEffect(() => {
    const flush = () => {
      const n = combo.current;
      if (Date.now() - lastTap.current > COMBO_MS) return;
      if (n < 3 || n <= startBest.current || n <= savedN.current) return;
      savedN.current = n;
      try {
        navigator.sendBeacon("/api/bday?live=1", new Blob([JSON.stringify({ key: day.key, combo: n })], { type: "application/json" }));
      } catch {
        /* 보내지 못하면 3초마다 남긴 데까지 */
      }
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [day.key]);

  // 올라가는 풍선은 누르면 터진다 (제작자 2026-11-07 '풍선 올라가는 것도 누르면 터지게'): 풍선을 맞힌 누름은 아래 칸·단추로 가지 않는다
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const f = fx.current;
      if (!f || !e.isPrimary || !f.hasBalloons()) return;
      const hit = f.popAt(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      swallow.current = Date.now();
      const n = bumpRef.current(hit.x, hit.y);
      popRef.current(n >= 2 ? `POP! x${n}` : "POP!", hit.x, hit.y - 18, "bday-popword", 900);
      // 풍선 터뜨리기도 누른 횟수에 든다: 10번째면 생일 메인 폭죽 (스티커 위로 지나가는 풍선을 눌러도 빠지지 않게)
      if (++tapCount.current % FINALE_EVERY === 0) grandRef.current();
    };
    const onClick = (e: MouseEvent) => {
      if (Date.now() - swallow.current < 700) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  /** 끊긴 콤보 이어서 하기 (제작자 2026-11-08 '쿨쿨 쿠루미 억울하게 끊겼으니까 11700 에서 이어서, 웹 들어가면 이어서 하기 버튼'): 6초 안에 스티커를 누르면 그 콤보부터 이어진다 */
  function resumeCombo() {
    const r = boardRef.current?.resume;
    if (!r) return;
    setResumed(true);
    void api<{ combo: number }>("/api/bday/resume", "POST", { key: day.key }).catch(() => {});
    const now = Date.now();
    combo.current = r;
    // 다음 누름까지 1.3초가 아니라 6초를 기다려 준다
    lastTap.current = now + RESUME_GRACE - COMBO_MS;
    window.clearTimeout(comboT.current);
    comboT.current = window.setTimeout(() => endCombo(r), RESUME_GRACE);
    passed.current = new Set();
    startBest.current = boardRef.current?.mine?.best ?? 0;
    savedN.current = 0;
    setCb({ n: r, key: ++seq });
    const p = posRef.current;
    const word = `${r.toLocaleString("ko-KR")} 이어서!`;
    pop(word, shoutFit(word, SHOUTS.length, p.x + w / 2, vw), Math.max(80, p.y - 40), "bday-shout bday-shout-hot", 2200, SHOUTS.length, "6초 안에 누르세요");
    const f = fx.current;
    if (f && !reduced()) {
      f.ring(p.x + w / 2, p.y + h / 2, "#ffd27a", 420);
      f.explode(p.x + w / 2, p.y + h / 2 - 20, "double", PALETTE, 0.9);
    }
    garland.current?.shake(1.2);
  }
  function celebrate(tx: number, ty: number) {
    const t = performance.now();
    const f = fx.current;
    const q = f?.quality ?? 1;
    // 스티커가 튀고 별이 터지는 것은 너무 잦으면 건너뛴다 (콤보는 누를 때마다 센다)
    if (ready(q, t - lastHit.current, HIT_GAP)) {
      lastHit.current = t;
      if (taps === 0) setTaps(1);
      else {
        // 빛살·고리·별·스티커 튐·번쩍임은 한 번 만든 것을 다시 돌린다 (별 방향만 돌려서 매번 다르게)
        if (hitEl.current) {
          hitEl.current.style.transform = `rotate(${Math.round(Math.random() * 360)}deg)`;
          replay(hitEl.current, true);
        }
        replay(bodyEl.current, true);
        replay(edgeEl.current);
      }
    }
    const p = posRef.current;
    const count = ++tapCount.current;
    const grand = count % FINALE_EVERY === 0;
    // 노래 줄: 너무 잦으면 건너뛴다 (노래는 보인 줄만큼 이어진다)
    if (ready(q, t - lastLine.current.t, LINE_GAP)) {
      const n = lyric.current;
      const text = lyrics[n % lyrics.length];
      lyric.current++;
      // 노래 줄은 스티커 위에서 나와 화면 위로 끝없이 올라가 사라진다 (제작자 2026-11-07 '해피 버스데이 텍스트는 끝없이 올라가서 사라지게').
      // 화면 맨 위에 붙어 있으면 스티커 아래에서 나온다. 가로는 글자 폭만큼 화면 안으로. 앞 줄이 아직 출발점 가까이 있으면 그 위에서 나온다 (겹치지 않게)
      const tw = [...text].reduce((k, c) => k + (/[가-힣]/.test(c) ? 14 : 8), 26);
      const lx = Math.min(Math.max(p.x + w / 2, tw / 2 + 6), vw - tw / 2 - 6);
      const below = p.y < 44;
      let ly = below ? p.y + h + 30 : p.y - 6;
      const prev = lastLine.current;
      if (prev.speed) {
        const cur = prev.y - ((t - prev.t) / 1000) * prev.speed;
        if (cur > ly - 30) ly = cur - 30;
      }
      // '… 님 생일 축하해요' 줄은 더 천천히
      const keep = n % lyrics.length === lyrics.length - 1;
      const speed = keep ? 65 : 85;
      const rise = Math.max(120, ly + 80);
      const dur = rise / speed;
      lastLine.current = { y: ly, t, speed };
      const line: Line = { id: ++seq, x: lx, y: ly, text, hue: HUES[n % HUES.length], cls: grand ? "bday-line-gold" : curVariant().line, keep, rise, dur };
      setLines((ls) => [...ls.slice(q < 0.6 ? -8 : -15), line]);
      window.setTimeout(() => setLines((ls) => ls.filter((l) => l.id !== line.id)), dur * 1000 + 100);
    }
    const cn = bump(tx, ty);
    setHitTier(tierOf(cn));
    if (reduced() || !f) return;
    if (grand) {
      // 메인 폭죽은 늘 다 터뜨리고, 폰이 끊길 때만 7초에 한 번 다 터뜨리고 그 사이 10번째는 가볍게
      lastFx.current = t;
      if (ready(q, t - lastGrand.current, GRAND_GAP)) {
        lastGrand.current = t;
        grandFinale(ctxOf(f, tx, ty, false, cn));
      } else liteFinale(ctxOf(f, tx, ty, false, cn));
      return;
    }
    // 다섯 안의 큰 효과: 잘 돌면 누를 때마다, 폰이 끊길 때만 띄엄띄엄 (그 사이는 누른 곳 작은 불꽃)
    if (ready(q, t - lastFx.current, FX_GAP)) {
      lastFx.current = t;
      const variant = nextVariant();
      setIdle(variant.idle);
      variant.tap(ctxOf(f, tx, ty, lyric.current % lyrics.length === 4, cn));
    } else if (q > 0.35) f.explode(tx, ty, pick(["star", "pixel", "ring"]), STAR_COLORS, 0.3);
  }
  /** 효과에 넘기는 것 (누른 곳, 스티커 자리, 글자·띠 띄우기) */
  function ctxOf(f: Fx, tx: number, ty: number, finale: boolean, cn: number): TapCtx {
    const p = posRef.current;
    return {
      fx: f,
      x: tx,
      y: ty,
      cx: p.x + w / 2,
      cy: p.y + h / 2,
      top: p.y,
      vw,
      vh,
      finale,
      combo: cn,
      pop: (t, x, y, cls) => pop(t, x, y, cls),
      banner: (t, cls, ms) => {
        if (cls.includes("bday-finale")) return showFinale(Math.max(ms, 5200));
        // 'HAPPY BIRTHDAY' 띠는 맨 위에 늘 걸려 있다 (누를 때마다 뛴다)
        if (cls.includes("bday-bunting")) return;
        // '생일 축하해요' 가 떠 있는 동안은 다른 큰 글자를 겹쳐 띄우지 않는다
        if (finaleOn.current) return;
        const it: Banner = { id: ++seq, text: t, cls };
        setBanner(it);
        window.setTimeout(() => setBanner((b) => (b?.id === it.id ? null : b)), ms);
      },
    };
  }
  // 그날 처음 열면 (이 기기에 한 번) 저절로 생일 메인 폭죽과 '생일 축하해요' (제작자 2026-11-07 '11월 8일 되는 순간 화려하게')
  const grandRef = useRef<() => void>(() => {});
  grandRef.current = () => {
    garland.current?.shake(1.2);
    const p = posRef.current;
    const f = fx.current;
    if (reduced() || !f) return showFinale(5200);
    const t = performance.now();
    lastFx.current = t;
    if (ready(f.quality, t - lastGrand.current, GRAND_GAP)) {
      lastGrand.current = t;
      grandFinale(ctxOf(f, p.x + w / 2, p.y + h / 2, false, combo.current));
    } else liteFinale(ctxOf(f, p.x + w / 2, p.y + h / 2, false, combo.current));
  };
  const autoRef = useRef<() => void>(() => {});
  autoRef.current = () => {
    garland.current?.shake(1);
    const p = posRef.current;
    if (reduced() || !fx.current) return showFinale(5200);
    lastGrand.current = performance.now();
    grandFinale(ctxOf(fx.current, p.x + w / 2, p.y + h / 2, false, 0));
  };
  useEffect(() => {
    if (!live) return;
    const k = `sapphire.bday.opened.${day.key}`;
    try {
      if (localStorage.getItem(k)) return;
      localStorage.setItem(k, "1");
    } catch {
      return;
    }
    const t = window.setTimeout(() => autoRef.current(), 1200);
    return () => window.clearTimeout(t);
    // 미리 보던 화면이 켜진 채 0시가 되어도 터진다
  }, [day.key, live]);

  function down(e: RPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y, moved: false, id: e.pointerId };
  }
  function move(e: RPointerEvent<HTMLDivElement>) {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) > 7) {
      p.moved = true;
      setDragging(true);
    }
    if (p.moved) setPos(clamp({ x: p.px + dx, y: p.py + dy }));
  }
  function up(e: RPointerEvent<HTMLDivElement>) {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (p.moved) {
      setDragging(false);
      save(posRef.current);
    } else if (e.type === "pointerup") celebrate(e.clientX, e.clientY);
  }

  const tier = cb ? tierOf(cb.n) : 0;
  const cbX = Math.min(Math.max(pos.x + w - 10, 44), vw - 44);
  const cbY = pos.y < 60 ? pos.y + h - 30 : pos.y + 6;
  return (
    <>
      <div
        className={"bday " + idle + (dragging ? " bday-drag" : "") + (tier >= 3 ? " bday-fever" : "")}
        style={{ width: w, height: h, transform: `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)` }}
        role="button"
        tabIndex={0}
        aria-label={`${day.who} 님 생일 축하 스티커`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            const p = posRef.current;
            celebrate(p.x + w / 2, p.y + h / 2);
          }
        }}
      >
        <span className="bday-fever-ring" aria-hidden />
        <span className="bday-aura" aria-hidden>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        {taps > 0 && !reduced() && (
          <span ref={hitEl} className={"bday-hit bday-hit-t" + hitTier} aria-hidden>
            <i className="bday-hit-rays" />
            <i className="bday-hit-ring" />
            <i className="bday-hit-ring bday-hit-ring2" />
            {hitTier >= 1 && <i className="bday-hit-ring bday-hit-ring3" />}
            {starsOf(hitTier + 1, hitTier).map((st, k) => (
              <b key={k} style={{ "--a": `${st.a}deg`, "--d": `${st.d}px`, "--c": st.c, animationDelay: `${st.dl}s` } as CSSProperties}>
                ✦
              </b>
            ))}
          </span>
        )}
        <div className="bday-bob">
          <div ref={bodyEl} className={"bday-body" + (taps ? " bday-squish" : " bday-in")}>
            <img className="bday-img" src={day.base} alt="" draggable={false} />
            <img
              className={"bday-img bday-bubble" + (taps ? " bday-bubble-pop" : "")}
              src={day.bubble}
              alt=""
              draggable={false}
              style={{ transformOrigin: `${day.tip[0] * 100}% ${day.tip[1] * 100}%` }}
            />
            {taps > 0 && !reduced() && <i className="bday-hit-flash" aria-hidden />}
            <span className="bday-ribbon">HAPPY BIRTHDAY</span>
          </div>
        </div>
        <button
          type="button"
          className="bday-rank-btn"
          aria-label="생일 콤보 순위"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setRankOpen(true);
            void loadBoard();
          }}
        >
          🏆<span>순위</span>
        </button>
        {board?.resume && !resumed && (
          <button
            type="button"
            className={"bday-resume" + (pos.y < 40 ? " bday-resume-below" : "")}
            style={{ left: Math.min(Math.max(pos.x + w / 2, 100), vw - 100) - pos.x }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              resumeCombo();
            }}
          >
            {board.resume.toLocaleString("ko-KR")} 콤보 이어서 하기
          </button>
        )}
      </div>
      {createPortal(
        <div className="bday-fx" aria-hidden>
          {/* 맨 위 현수막: 그날 내내 (제작자 2026-11-07 '맨 위에 해피 버스데이는 24시간 내내 띄워 줘'). 깃발은 Garland 가 그린다 */}
          <div ref={garlandEl} className="bday-garland" />
          {tier >= 2 && cb && <i ref={edgeEl} className={"bday-edge bday-edge-t" + tier} />}
          {lines.map((l) => (
            <span key={l.id} className="bday-line-wrap" style={{ left: l.x, top: l.y, "--rise": `${l.rise}px`, "--dur": `${l.dur}s` } as CSSProperties}>
              <span className={"bday-line " + l.cls} style={{ "--hue": `${l.hue}deg` } as CSSProperties}>
                {l.cls.includes("bday-line-karaoke")
                  ? [...l.text].map((ch, i) => (
                      <i key={i} style={{ "--i": i } as CSSProperties}>
                        {ch}
                      </i>
                    ))
                  : l.text}
              </span>
            </span>
          ))}
          {pops.map((q) =>
            q.lv ? (
              <span key={q.id} className={q.cls} style={{ left: q.x, top: q.y, "--lv": q.lv, "--len": emLen(q.text) / 0.645 } as CSSProperties}>
                <span className="bday-shout-w">
                  {[...q.text].map((ch, i) => (
                    <i key={i} style={{ "--i": i } as CSSProperties}>
                      {ch}
                    </i>
                  ))}
                </span>
                <small>{q.sub ?? `STAGE ${q.lv}`}</small>
              </span>
            ) : (
              <span key={q.id} className={q.cls} style={{ left: q.x, top: q.y }}>
                {q.text}
              </span>
            ),
          )}
          {pass && (
            <div key={pass.id} className={"bday-pass" + (pass.rank === 1 ? " bday-pass-1" : "")}>
              <b>{pass.rank === 1 ? "👑 1위 등극!" : `${["", "🥇", "🥈", "🥉"][pass.rank] ?? "🔥"} ${pass.rank}위로!`}</b>
              <small>
                <Nick name={pass.name} /> 님{pass.extra ? ` 외 ${pass.extra}명` : ""}을 제쳤어요
              </small>
            </div>
          )}
          {cb && (
            <div key={cb.key} ref={cbEl} className={"bday-cb bday-cb-t" + tier} style={{ left: cbX, top: cbY }}>
              <b>{cb.n}</b>
              <small>COMBO</small>
            </div>
          )}
          {result && (
            <div key={result.key} className={"bday-result" + (result.best ? " bday-result-best" : "")} style={{ left: Math.min(Math.max(pos.x + w / 2, 90), vw - 90), top: pos.y + h * 0.42 }}>
              <b>{result.n} COMBO</b>
              <small>
                {result.best ? "최고 기록!" : `내 최고 ${result.prev}`}
                {result.rank ? ` · ${result.rank}위` : ""}
              </small>
            </div>
          )}
          {banner && (
            <div key={banner.id} className={"bday-banner " + banner.cls}>
              {[...banner.text].map((ch, i) => (
                <i key={i} style={{ "--i": i } as CSSProperties}>
                  {ch === " " ? " " : ch}
                </i>
              ))}
            </div>
          )}
          {finale && (
            <div key={finale.id} className={"bday-banner bday-finale" + (finale.out ? " bday-finale-out" : "")}>
              <span className="bday-finale-cake">🎂</span>
              <span className="bday-finale-t">생일 축하해요</span>
              <span className="bday-finale-who">{day.who}</span>
            </div>
          )}
        </div>,
        document.body,
      )}
      <ComboTicker
        board={board}
        me={me}
        home={home}
        live={cb ? cb.n : null}
        onOpen={() => {
          setRankOpen(true);
          void loadBoard();
        }}
      />
      {rankOpen && <ComboRank day={day} me={me} board={board} onClose={() => setRankOpen(false)} />}
    </>
  );
}
