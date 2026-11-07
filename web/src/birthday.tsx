import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { inFloat } from "./platform";
import { useTutorial } from "./tutorialState";

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
    ratio: 505 / 600,
    tip: [0.4176, 0.3373],
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

// ---------- 효과 ----------
type Kind = "heart" | "spark" | "confetti" | "firework" | "balloon" | "party";
interface Bit {
  id: number;
  x: number;
  y: number;
  style: CSSProperties;
  cls: string;
  text?: string;
}
interface Line {
  id: number;
  x: number;
  y: number;
  text: string;
  hue: number;
}
const HEARTS = ["❤️", "💖", "💗", "💕", "💘", "💝"];
const SPARKS = ["✨", "⭐", "🌟", "💫"];
const PARTY = ["🎉", "🥳", "🎂", "🎁", "🍰", "🎊"];
/** 노래 줄 바탕색 (분홍, 금, 사파이어, 보라, 민트) */
const HUES = [335, 38, 228, 280, 165];
const COLORS = ["#ff5c8a", "#ffc35c", "#6f8fff", "#7ee2a8", "#c58bff", "#ff8a3d", "#5ce1ff", "#fff27a"];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pickOf = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
let seq = 0;

/** 한 번 누를 때 터지는 것들 (하트는 늘, 나머지 둘은 랜덤) */
function burst(x: number, y: number, kinds: Kind[]): Bit[] {
  const out: Bit[] = [];
  const add = (b: Omit<Bit, "id">) => out.push({ ...b, id: ++seq });
  for (const k of kinds) {
    if (k === "heart" || k === "spark" || k === "party") {
      const set = k === "heart" ? HEARTS : k === "spark" ? SPARKS : PARTY;
      const n = k === "party" ? 5 : 8;
      for (let i = 0; i < n; i++) {
        const a = rnd(-Math.PI * 0.95, -Math.PI * 0.05);
        const d = rnd(50, 130);
        add({
          x,
          y,
          cls: "bd-bit bd-emoji",
          text: pickOf(set),
          style: {
            "--dx": `${Math.cos(a) * d}px`,
            "--dy": `${Math.sin(a) * d - rnd(10, 40)}px`,
            "--rot": `${rnd(-50, 50)}deg`,
            "--s": `${rnd(0.8, 1.5)}`,
            animationDuration: `${rnd(0.9, 1.5)}s`,
            animationDelay: `${rnd(0, 0.12)}s`,
          } as CSSProperties,
        });
      }
    } else if (k === "confetti") {
      for (let i = 0; i < 18; i++) {
        const a = rnd(-Math.PI, 0);
        const d = rnd(60, 150);
        add({
          x,
          y,
          cls: "bd-bit bd-confetti",
          style: {
            "--dx": `${Math.cos(a) * d}px`,
            "--dy": `${Math.sin(a) * d * 0.7 + rnd(40, 110)}px`,
            "--rot": `${rnd(-540, 540)}deg`,
            "--s": "1",
            background: pickOf(COLORS),
            width: `${Math.round(rnd(4, 7))}px`,
            height: `${Math.round(rnd(7, 11))}px`,
            animationDuration: `${rnd(1.1, 1.8)}s`,
          } as CSSProperties,
        });
      }
    } else if (k === "firework") {
      // 스티커 위쪽 아무 데서나 팡: 가운데 번쩍 + 둘레로 퍼지는 불꽃
      const fx = x + rnd(-70, 70);
      const fy = y - rnd(70, 150);
      const color = pickOf(COLORS);
      const color2 = pickOf(COLORS);
      add({ x: fx, y: fy, cls: "bd-bit bd-flash", style: { background: color, animationDuration: "0.5s" } as CSSProperties });
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd(-0.1, 0.1);
        const d = rnd(46, 70);
        add({
          x: fx,
          y: fy,
          cls: "bd-bit bd-spark",
          style: {
            "--dx": `${Math.cos(a) * d}px`,
            "--dy": `${Math.sin(a) * d + 14}px`,
            "--rot": "0deg",
            "--s": "1",
            background: i % 2 ? color : color2,
            animationDuration: `${rnd(0.8, 1.1)}s`,
          } as CSSProperties,
        });
      }
    } else if (k === "balloon") {
      for (let i = 0; i < 4; i++) {
        add({
          x: x + rnd(-60, 60),
          y: y + rnd(-10, 20),
          cls: "bd-bit bd-emoji bd-balloon",
          text: "🎈",
          style: {
            "--dx": `${rnd(-30, 30)}px`,
            "--dy": `${-rnd(220, 340)}px`,
            "--rot": `${rnd(-15, 15)}deg`,
            "--s": `${rnd(1, 1.5)}`,
            filter: `hue-rotate(${Math.round(rnd(0, 360))}deg)`,
            animationDuration: `${rnd(2.2, 3.2)}s`,
            animationDelay: `${rnd(0, 0.3)}s`,
          } as CSSProperties,
        });
      }
    }
  }
  return out;
}

const EXTRA: Kind[] = ["spark", "confetti", "firework", "balloon", "party"];

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
  const [bits, setBits] = useState<Bit[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [dragging, setDragging] = useState(false);
  const press = useRef<{ x: number; y: number; px: number; py: number; moved: boolean; id: number } | null>(null);
  const lyric = useRef(0);
  const linesRef = useRef<Line[]>([]);
  linesRef.current = lines;
  const posRef = useRef(pos);
  posRef.current = pos;

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

  function celebrate(cx: number, cy: number) {
    setTaps((t) => t + 1);
    const p = posRef.current;
    const text = lyrics[lyric.current % lyrics.length];
    lyric.current++;
    // 노래 줄은 스티커 위에 (화면 맨 위에 붙어 있으면 아래에), 가로는 글자 폭만큼 화면 안으로, 빨리 누르면 앞 줄 위로 쌓는다
    const tw = [...text].reduce((n, c) => n + (/[가-힣]/.test(c) ? 13 : 7.4), 22);
    const lx = Math.min(Math.max(p.x + w / 2, tw / 2 + 6), vw - tw / 2 - 6);
    const below = p.y < 44;
    const stack = linesRef.current.length;
    const ly = below ? p.y + h + 30 + stack * 26 : p.y - 6 - stack * 26;
    const line: Line = { id: ++seq, x: lx, y: ly, text, hue: HUES[lyric.current % HUES.length] };
    setLines((ls) => [...ls.slice(-3), line]);
    window.setTimeout(() => setLines((ls) => ls.filter((l) => l.id !== line.id)), 2600);
    if (reduced()) return;
    const extra = [...EXTRA].sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.4 ? 2 : 1);
    const made = burst(cx, cy, ["heart", ...extra]);
    setBits((bs) => [...bs.slice(-140), ...made]);
    const ids = new Set(made.map((b) => b.id));
    window.setTimeout(() => setBits((bs) => bs.filter((b) => !ids.has(b.id))), 3700);
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
        className={"bday" + (dragging ? " bday-drag" : "")}
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
          {bits.map((b) => (
            <span key={b.id} className={b.cls} style={{ left: b.x, top: b.y, ...b.style }}>
              {b.text}
            </span>
          ))}
          {lines.map((l) => (
            <span key={l.id} className="bday-line" style={{ left: l.x, top: l.y, "--hue": `${l.hue}deg` } as CSSProperties}>
              {l.text}
            </span>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
