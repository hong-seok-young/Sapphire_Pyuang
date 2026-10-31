// 정식 오픈 축하 (제작자 요청 2026-11-01: 클로즈베타를 끝내고 v1.0 으로 오픈. 들어오면 폭죽을 성대하게 한 번 쏘고 길드마스터의 오픈 글을 팝업으로).
// 오픈 뒤 2주(opening.json showDays) 동안, 계정마다 이 기기에서 한 번. 같은 글은 배포 때 첫 공지사항으로도 올라간다 (scripts/ci-d1.mjs).
// 처음 2.6초는 화면 가득 폭죽과 'GRAND OPEN' 글씨만, 그 뒤 글 칸이 올라오고 폭죽은 둘레에서 이어진다 (폰에서 글 칸에 가려 폭죽이 안 보여서).
// 움직임 줄이기를 켠 기기는 폭죽 없이 글만.
import { useEffect, useRef, useState } from "react";
import opening from "../opening.json";

const DAY = 86_400_000;
const seenKey = (user: string) => "sapphire.opening." + user;

/** 이 사람에게 오픈 축하를 띄울지 (오픈 날부터 2주, 이 기기에서 아직 안 봤으면) */
export function shouldCelebrate(user: string, now = Date.now()): boolean {
  const start = Date.parse(opening.openAt);
  if (!Number.isFinite(start) || now < start || now > start + opening.showDays * DAY) return false;
  try {
    return !localStorage.getItem(seenKey(user));
  } catch {
    return false; // 못 적는 기기는 매번 뜨지 않게 띄우지 않는다
  }
}

/** 폭죽: 아래에서 쏘아 올려 터지는 불꽃 (금색, 사파이어 파랑, 민트, 분홍, 흰색) */
function fireworks(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const COLORS = ["#ffd34d", "#5aa8ff", "#3fe0a0", "#ff7ad9", "#ffffff", "#b98cff", "#ff8a4d"];
  let w = 0;
  let h = 0;
  const size = () => {
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  window.addEventListener("resize", size);

  interface Rocket { x: number; y: number; vx: number; vy: number; top: number; color: string }
  interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
  const rockets: Rocket[] = [];
  const sparks: Spark[] = [];
  const pick = () => COLORS[Math.floor(Math.random() * COLORS.length)];
  const launch = () => {
    const x = w * (0.15 + Math.random() * 0.7);
    rockets.push({ x, y: h + 10, vx: (Math.random() - 0.5) * 1.2, vy: -(h / 70 + Math.random() * 3), top: h * (0.12 + Math.random() * 0.3), color: pick() });
  };
  const burst = (r: Rocket) => {
    const n = 90 + Math.floor(Math.random() * 60);
    const second = Math.random() < 0.5 ? pick() : r.color;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.1;
      const s = 1.5 + Math.random() * 4.5;
      const max = 55 + Math.random() * 45;
      sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: max, max, color: i % 3 ? r.color : second, size: 1.4 + Math.random() * 1.6 });
    }
  };

  // 처음에 한꺼번에 여러 발, 그 뒤 7초 동안 이어서 쏜다
  const started = performance.now();
  for (let i = 0; i < 4; i++) setTimeout(launch, i * 180);
  let nextLaunch = started + 700;
  let raf = 0;
  const frame = (t: number) => {
    // 지난 그림을 조금씩 지워 꼬리가 남게 (캔버스는 투명하게 둔다)
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    if (t - started < 7000 && t >= nextLaunch) {
      launch();
      if (Math.random() < 0.4) launch();
      nextLaunch = t + 350 + Math.random() * 450;
    }
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.x += r.vx;
      r.y += r.vy;
      r.vy += 0.06;
      ctx.fillStyle = r.color;
      ctx.fillRect(r.x - 1.5, r.y - 1.5, 3, 3);
      if (r.y <= r.top || r.vy >= 0) {
        burst(r);
        rockets.splice(i, 1);
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= 0.975;
      s.vy = s.vy * 0.975 + 0.05;
      s.life--;
      if (s.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.min(1, (s.life / s.max) * 1.4);
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }
    ctx.globalAlpha = 1;
    if (t - started < 7000 || rockets.length || sparks.length) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, w, h);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", size);
  };
}

/** 오픈 축하: 폭죽과 길드마스터의 오픈 글. '확인'을 누르면 이 기기에서는 다시 안 뜬다 */
export function Opening({ user, onClose }: { user: string; onClose: () => void }) {
  const sky = useRef<HTMLCanvasElement>(null);
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [card, setCard] = useState(calm);
  useEffect(() => {
    if (!sky.current || calm) return;
    const stop = fireworks(sky.current);
    const t = window.setTimeout(() => setCard(true), 2600);
    return () => {
      stop();
      window.clearTimeout(t);
    };
  }, [calm]);
  const close = () => {
    try {
      localStorage.setItem(seenKey(user), String(Date.now()));
    } catch {
      // 못 적어도 닫는다
    }
    onClose();
  };
  return (
    <div className="opening" role="dialog" aria-modal="true" aria-label={opening.title} onClick={() => setCard(true)}>
      <canvas ref={sky} className="opening-sky" aria-hidden />
      {!card && (
        <div className="opening-hero" aria-hidden>
          <img src="guild-mark.png" alt="" width={88} height={88} />
          <b>GRAND OPEN</b>
          <span>사파이어 길드 포탈</span>
        </div>
      )}
      {card && (
      <div className="panel opening-card" onClick={(e) => e.stopPropagation()}>
        <img className="opening-mark" src="guild-mark.png" alt="" width={56} height={56} />
        <p className="opening-kicker">GRAND OPEN</p>
        <h2>{opening.title}</h2>
        <div className="opening-body">{opening.body}</div>
        <p className="opening-meta">길드마스터 {opening.author} · 공지사항에도 있어요</p>
        <button className="btn" onClick={close}>
          확인
        </button>
      </div>
      )}
    </div>
  );
}
