import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "./auth";
import type { Me } from "./auth";
import { useBackClose } from "./backClose";
import { Nick } from "./kakao";
import { inFloat } from "./platform";
import { useTutorial } from "./tutorialState";
import { Fx, PALETTE, pick } from "./birthdayFx";

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
  return <Sticker day={day} me={me.id} />;
}

// ---------- 콤보 (제작자 2026-11-07 '스티커 누를 때마다 애니메이션 엄청 화려하게, 최대 콤보 순위도 어딘가에 나열') ----------
/** 이 안에 다시 누르면(스티커나 풍선) 콤보가 이어진다 */
const COMBO_MS = 1300;
/** 콤보가 커질수록 누를 때 터지는 것도 커진다 */
const tierOf = (n: number) => (n >= 50 ? 4 : n >= 30 ? 3 : n >= 15 ? 2 : n >= 5 ? 1 : 0);
const SHOUT: Record<number, string> = { 10: "GREAT!", 20: "AWESOME!", 30: "FEVER!", 50: "LEGEND!", 100: "GODLIKE!" };
const shoutOf = (n: number) => SHOUT[n] ?? (n > 100 && n % 50 === 0 ? `${n} COMBO!` : null);
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
}

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
 * 콤보 순위 전광판: 아래 탭 바로 위 한 줄에 순위가 흐른다 (제작자 2026-11-07 '순위 전광판도 맨 아래 5개 버튼 바로 윗줄에').
 * 홈에서는 '배치 편집·날씨·버전' 줄 위에. 누르면 순위 창
 */
function ComboTicker({ board, home, onOpen }: { board: Board | null; home: boolean; onOpen: () => void }) {
  const medal = ["🥇", "🥈", "🥉"];
  const top = board?.top.slice(0, 10) ?? [];
  const text = top.length
    ? top.map((r, k) => `${medal[k] ?? `${k + 1}위`} ${r.id} ${r.best}콤보`).join("     ")
    : "아직 기록이 없어요 · 스티커를 1.3초 안에 이어 눌러 1위에 도전해 보세요";
  return createPortal(
    <button type="button" className={"bday-ticker" + (home ? " bday-ticker-home" : "")} onClick={onOpen} aria-label="생일 콤보 순위 보기">
      <span className="bday-ticker-tag">🏆 콤보 순위</span>
      <span className="bday-ticker-box">
        <span className="bday-ticker-run" style={{ animationDuration: `${Math.max(10, text.length * 0.3)}s` }}>
          <span>{text}</span>
          <span aria-hidden>{text}</span>
        </span>
      </span>
    </button>,
    document.body,
  );
}

function Sticker({ day, me }: { day: Birthday; me: string }) {
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
  /** 맨 위 'HAPPY BIRTHDAY 마을모금함' 띠가 누를 때마다 차례로 뛰는 것 */
  const [hop, setHop] = useState(0);
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
  /** 스티커 둘레 꾸밈: 마지막에 터진 안의 것, 안 누르는 동안은 7초마다 다음 안으로 */
  const [idle, setIdle] = useState(() => VARIANTS[only ?? Math.floor(Math.random() * VARIANTS.length)].idle);
  const tapCount = useRef(0);
  const fx = useRef<Fx | null>(null);
  const lastTap = useRef(0);
  const combo = useRef(0);
  const comboT = useRef(0);
  const swallow = useRef(0);
  const [dragging, setDragging] = useState(false);
  const press = useRef<{ x: number; y: number; px: number; py: number; moved: boolean; id: number } | null>(null);
  const lyric = useRef(0);
  const lastLine = useRef<{ y: number; t: number; speed: number } | null>(null);
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
    return () => {
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
  const loadBoard = () =>
    api<Board>(`/api/bday?key=${encodeURIComponent(day.key)}`)
      .then(setBoard)
      .catch(() => {});
  useEffect(() => {
    void loadBoard();
    // 전광판: 보고 있는 동안 3분마다 새 순위 (모두가 자주 부르면 무료 요청 한도라 길게)
    const t = window.setInterval(() => {
      if (!document.hidden) void loadBoard();
    }, 180_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.key]);
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

  const pop = (t: string, x: number, y: number, cls: string, ms = 1400) => {
    const it: Pop = { id: ++seq, x: Math.min(Math.max(x, 60), vw - 60), y, text: t, cls };
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
    if (n >= 2) setCb({ n, key: ++seq });
    const word = shoutOf(n);
    const p = posRef.current;
    if (word) {
      pop(word, Math.min(Math.max(p.x + w / 2, 110), vw - 110), Math.max(70, p.y - 48), "bday-shout bday-shout-t" + tierOf(n), 1600);
      const f = fx.current;
      if (f && !reduced()) {
        f.shake();
        f.ring(p.x + w / 2, p.y + h / 2, "#ffd27a", 420);
        f.ring(p.x + w / 2, p.y + h / 2, "#ff7aa8", 320, 0.12);
        f.explode(p.x + w / 2, p.y + h / 2 - 20, "star", PALETTE, 1.15);
        f.confetti(p.x + w / 2, p.y + h / 2, -Math.PI / 2, 1.4, 50, [260, 560]);
      }
    } else if (n >= 15 && fx.current && !reduced()) {
      // 콤보가 이어지는 동안은 누른 곳에서도 작은 불꽃
      fx.current.explode(x, y, pick(["star", "ring", "pixel"]), STAR_COLORS, 0.45);
    }
    return n;
  }
  /** 콤보가 끝나면 (1.3초 동안 안 누르면) 결과를 보이고, 내 최고보다 크면 서버에 남긴다 */
  function endCombo(n: number) {
    setCb(null);
    if (n < 3) return;
    const prev = boardRef.current?.mine?.best ?? 0;
    const best = n > prev;
    const key = ++seq;
    setResult({ n, best, prev, rank: boardRef.current?.mine?.rank ?? null, key });
    window.setTimeout(() => setResult((r) => (r?.key === key ? null : r)), 3000);
    if (best)
      api<Board>("/api/bday", "POST", { key: day.key, combo: n })
        .then((b) => {
          setBoard(b);
          setResult((r) => (r?.key === key ? { ...r, rank: b.mine?.rank ?? null } : r));
        })
        .catch(() => {});
  }
  const bumpRef = useRef(bump);
  bumpRef.current = bump;
  const popRef = useRef(pop);
  popRef.current = pop;

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

  function celebrate(tx: number, ty: number) {
    setTaps((t) => t + 1);
    setHop((k) => k + 1);
    const p = posRef.current;
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
    const tnow = performance.now();
    if (prev) {
      const cur = prev.y - ((tnow - prev.t) / 1000) * prev.speed;
      if (cur > ly - 30) ly = cur - 30;
    }
    const count = ++tapCount.current;
    const grand = count % FINALE_EVERY === 0;
    const variant = nextVariant();
    setIdle(variant.idle);
    // '… 님 생일 축하해요' 줄은 더 천천히
    const keep = n % lyrics.length === lyrics.length - 1;
    const speed = keep ? 65 : 85;
    const rise = Math.max(120, ly + 80);
    const dur = rise / speed;
    lastLine.current = { y: ly, t: tnow, speed };
    const line: Line = { id: ++seq, x: lx, y: ly, text, hue: HUES[n % HUES.length], cls: grand ? "bday-line-gold" : variant.line, keep, rise, dur };
    setLines((ls) => [...ls.slice(-15), line]);
    window.setTimeout(() => setLines((ls) => ls.filter((l) => l.id !== line.id)), dur * 1000 + 100);
    const cn = bump(tx, ty);
    setHitTier(tierOf(cn));
    if (reduced() || !fx.current) return;
    (grand ? grandFinale : variant.tap)(ctxOf(fx.current, tx, ty, n % lyrics.length === 3, cn));
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
    setHop((k) => k + 1);
    const p = posRef.current;
    if (reduced() || !fx.current) return showFinale(5200);
    grandFinale(ctxOf(fx.current, p.x + w / 2, p.y + h / 2, false, combo.current));
  };
  const autoRef = useRef<() => void>(() => {});
  autoRef.current = () => {
    setHop((k) => k + 1);
    const p = posRef.current;
    if (reduced() || !fx.current) return showFinale(5200);
    grandFinale(ctxOf(fx.current, p.x + w / 2, p.y + h / 2, false, 0));
  };
  useEffect(() => {
    if (Date.now() < day.start) return;
    const k = `sapphire.bday.opened.${day.key}`;
    try {
      if (localStorage.getItem(k)) return;
      localStorage.setItem(k, "1");
    } catch {
      return;
    }
    const t = window.setTimeout(() => autoRef.current(), 1200);
    return () => window.clearTimeout(t);
  }, [day.key, day.start]);

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
  const garland = [...`HAPPY BIRTHDAY ${day.who}`];
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
          <span key={taps} className={"bday-hit bday-hit-t" + hitTier} aria-hidden>
            <i className="bday-hit-rays" />
            <i className="bday-hit-ring" />
            <i className="bday-hit-ring bday-hit-ring2" />
            {hitTier >= 1 && <i className="bday-hit-ring bday-hit-ring3" />}
            {starsOf(taps, hitTier).map((st, k) => (
              <b key={k} style={{ "--a": `${st.a}deg`, "--d": `${st.d}px`, "--c": st.c, animationDelay: `${st.dl}s` } as CSSProperties}>
                ✦
              </b>
            ))}
          </span>
        )}
        <div className="bday-bob">
          <div key={taps} className={"bday-body" + (taps ? " bday-squish" : " bday-in")}>
            <img className="bday-img" src={day.base} alt="" draggable={false} />
            <img
              className={"bday-img bday-bubble" + (taps ? " bday-bubble-pop" : "")}
              src={day.bubble}
              alt=""
              draggable={false}
              style={{ transformOrigin: `${day.tip[0] * 100}% ${day.tip[1] * 100}%` }}
            />
            {taps > 0 && !reduced() && <i key={taps} className="bday-hit-flash" aria-hidden />}
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
      </div>
      {createPortal(
        <div className="bday-fx" aria-hidden>
          {/* 맨 위 띠: 그날 내내 (제작자 2026-11-07 '맨 위에 해피 버스데이는 24시간 내내 띄워 줘') */}
          <div className="bday-garland" style={{ "--n": garland.length } as CSSProperties}>
            <span key={hop} className={"bday-garland-row" + (hop ? " bday-garland-hop" : "")}>
              {garland.map((ch, i) => (
                <b key={i} style={{ "--i": i } as CSSProperties}>
                  <em>{ch === " " ? " " : ch}</em>
                </b>
              ))}
            </span>
          </div>
          {tier >= 2 && cb && <i key={cb.key} className={"bday-edge bday-edge-t" + tier} />}
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
          {pops.map((q) => (
            <span key={q.id} className={q.cls} style={{ left: q.x, top: q.y }}>
              {q.text}
            </span>
          ))}
          {cb && (
            <div key={cb.key} className={"bday-cb bday-cb-t" + tier} style={{ left: cbX, top: cbY }}>
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
        home={home}
        onOpen={() => {
          setRankOpen(true);
          void loadBoard();
        }}
      />
      {rankOpen && <ComboRank day={day} me={me} board={board} onClose={() => setRankOpen(false)} />}
    </>
  );
}
