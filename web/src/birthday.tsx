import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { inFloat } from "./platform";
import { useTutorial } from "./tutorialState";
import { Fx, PALETTE, pick } from "./birthdayFx";

/**
 * 생일 스티커 (제작자 요청 2026-11-07: '마을모금함이 길마인데 11월 8일 생일이야, 자정부터 자정까지 24시간 동안 웹 화면에
 * 저 몸짱과 마을모금함과 낼름낼름낼름 말풍선만 잘라서 스티커처럼, 드래그해서 움직일 수도 있고 클릭하면 해피 버스데이 투 유 텍스트가
 * 하나씩, 하트와 폭죽 등등 막 랜덤으로').
 * 그림은 제작자가 준 게임 스샷에서 몸짱 동상·캐릭터·말풍선만 오린 것 (비공개 자료 이미지/생일, 자료/scripts/make_birthday_sticker.py ->
 * /data/birthday, 로그인한 길드원에게만). 화면 어디서나 떠 있고, 끌면 옮겨지고(이 기기에 자리 기억), 누르면 노래 한 줄과 하트·폭죽·풍선·반짝이가 랜덤으로.
 * 그날 한국 시간 0시부터 24시간만 보인다. 앱개발자는 미리 본다. 게임과 상관없는 꾸밈이라 게임 안전 규칙에 맞는다
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
    base: "/data/birthday/bday-base.png",
    bubble: "/data/birthday/bday-bubble.png",
    ratio: 503 / 600,
    tip: [0.4155, 0.3373],
  },
];

/** 지금 보일 생일: 그날 0시부터 24시간만, 앱개발자도 미리 보지 않는다 (제작자 2026-11-07 '11월 8일이 생일이라고, 내려') */
function current(now: number): Birthday | null {
  return BIRTHDAYS.find((b) => now >= b.start && now < b.end) ?? null;
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
  /** 노래의 마지막 줄 (네 번째 누름마다): 피날레 */
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
    tap: ({ fx, x, y, vw, vh, finale, combo, pop, banner }) => {
      fx.explode(x, y, "pixel", PALETTE, 0.8);
      for (let i = 0; i < 2; i++) fx.rocket(rnd(0.15, 0.85) * vw, vh + 10, rnd(0.15, 0.85) * vw, rnd(0.12, 0.38) * vh, "pixel", PALETTE, 0.15 + i * 0.25);
      fx.shake();
      pop("+1 ♥", x, y - 26, "bday-score");
      if (combo >= 2) pop(`x${combo} COMBO!`, x, y - 52, "bday-combo");
      banner(finale ? "LEVEL UP!" : "HAPPY BIRTHDAY", finale ? "bday-rainbow bday-levelup" : "bday-rainbow", 2300);
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
/** 쓸 안 (초안 볼 때는 이 기기에 적은 번호, 아니면 고른 안) */
export const DEFAULT_FX = 0;
function variantOf(): Variant {
  try {
    const n = Number(localStorage.getItem(FX_KEY));
    if (Number.isInteger(n) && n >= 1 && n <= VARIANTS.length) return VARIANTS[n - 1];
  } catch {
    /* 기본 */
  }
  return VARIANTS[DEFAULT_FX];
}

export function BirthdaySticker() {
  const [now, setNow] = useState(() => Date.now());
  const tut = useTutorial();
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const day = current(now);
  if (!day || inFloat || tut) return null;
  return <Sticker day={day} />;
}

function Sticker({ day }: { day: Birthday }) {
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
  const variant = useRef(variantOf()).current;
  const fx = useRef<Fx | null>(null);
  const lastTap = useRef(0);
  const combo = useRef(0);
  const [dragging, setDragging] = useState(false);
  const press = useRef<{ x: number; y: number; px: number; py: number; moved: boolean; id: number } | null>(null);
  const lyric = useRef(0);
  const linesRef = useRef<Line[]>([]);
  linesRef.current = lines;
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    const f = new Fx();
    f.mount();
    fx.current = f;
    return () => f.destroy();
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

  function celebrate(tx: number, ty: number) {
    setTaps((t) => t + 1);
    const p = posRef.current;
    const n = lyric.current;
    const text = lyrics[n % lyrics.length];
    lyric.current++;
    // 노래 줄은 스티커 위에 (화면 맨 위에 붙어 있으면 아래에), 가로는 글자 폭만큼 화면 안으로, 빨리 누르면 앞 줄 위로 쌓는다
    const tw = [...text].reduce((k, c) => k + (/[가-힣]/.test(c) ? 14 : 8), 26);
    const lx = Math.min(Math.max(p.x + w / 2, tw / 2 + 6), vw - tw / 2 - 6);
    const below = p.y < 44;
    const stack = linesRef.current.length;
    const ly = below ? p.y + h + 30 + stack * 28 : p.y - 6 - stack * 28;
    const line: Line = { id: ++seq, x: lx, y: ly, text, hue: HUES[n % HUES.length], cls: variant.line };
    setLines((ls) => [...ls.slice(-3), line]);
    window.setTimeout(() => setLines((ls) => ls.filter((l) => l.id !== line.id)), 2800);
    const now = Date.now();
    combo.current = now - lastTap.current < 1300 ? combo.current + 1 : 1;
    lastTap.current = now;
    if (reduced() || !fx.current) return;
    variant.tap({
      fx: fx.current,
      x: tx,
      y: ty,
      cx: p.x + w / 2,
      cy: p.y + h / 2,
      top: p.y,
      vw,
      vh,
      finale: n % lyrics.length === 3,
      combo: combo.current,
      pop: (t, x, y, cls) => {
        const it: Pop = { id: ++seq, x: Math.min(Math.max(x, 60), vw - 60), y, text: t, cls };
        setPops((ps) => [...ps.slice(-6), it]);
        window.setTimeout(() => setPops((ps) => ps.filter((q) => q.id !== it.id)), 1400);
      },
      banner: (t, cls, ms) => {
        const it: Banner = { id: ++seq, text: t, cls };
        setBanner(it);
        window.setTimeout(() => setBanner((b) => (b?.id === it.id ? null : b)), ms);
      },
    });
  }

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

  return (
    <>
      <div
        className={"bday " + variant.idle + (dragging ? " bday-drag" : "")}
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
        <span className="bday-aura" aria-hidden>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
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
            <span className="bday-ribbon">HAPPY BIRTHDAY</span>
          </div>
        </div>
      </div>
      {createPortal(
        <div className="bday-fx" aria-hidden>
          {lines.map((l) => (
            <span key={l.id} className={"bday-line " + l.cls} style={{ left: l.x, top: l.y, "--hue": `${l.hue}deg` } as CSSProperties}>
              {l.cls === "bday-line-karaoke"
                ? [...l.text].map((ch, i) => (
                    <i key={i} style={{ "--i": i } as CSSProperties}>
                      {ch}
                    </i>
                  ))
                : l.text}
            </span>
          ))}
          {pops.map((q) => (
            <span key={q.id} className={q.cls} style={{ left: q.x, top: q.y }}>
              {q.text}
            </span>
          ))}
          {banner && (
            <div key={banner.id} className={"bday-banner " + banner.cls}>
              {banner.cls.includes("bday-rainbow")
                ? [...banner.text].map((ch, i) => (
                    <i key={i} style={{ "--i": i } as CSSProperties}>
                      {ch === " " ? "\u00a0" : ch}
                    </i>
                  ))
                : banner.cls === "bday-bunting"
                  ? [...`${banner.text} ${day.who}`].map((ch, i) => (
                      <b key={i} style={{ "--i": i } as CSSProperties}>
                        {ch === " " ? "\u00a0" : ch}
                      </b>
                    ))
                  : (
                    <>
                      <span className="bday-finale-cake">🎂</span>
                      <span className="bday-finale-t">{banner.text}</span>
                      <span className="bday-finale-who">{day.who}</span>
                    </>
                  )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
