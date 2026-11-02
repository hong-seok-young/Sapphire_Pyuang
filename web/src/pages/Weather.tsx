// 홈 화면의 날씨 효과 (제작자 요청 2026-11-02 초안, src/weather.ts): 내 지역이 비면 비, 눈이면 눈, 천둥이면 번개.
// 앱의 도트 그림과 맞게 네모 픽셀로 그린다. 화면을 누르는 데는 걸리지 않고(pointer-events: none), 다른 앱에 가 있으면 멈추고,
// 움직임 줄이기면 그리지 않는다. App.tsx 가 홈일 때 <main> 밖에 그린다 (.page 의 transform 안이면 위에서 내려온다)
import { useEffect, useRef, useState } from "react";
import type { Me } from "../auth";
import { TEST_IDS } from "../auth";
import { PREVIEW, SKY_NAME, WEATHER_OPEN, skyIcon, useWeather } from "../weather";
import type { Sky } from "../weather";

/** 비: 한 화면(400x800)에 몇 줄기, 빠르기(px/frame), 길이, 바람(px/frame), 진하기 */
const RAIN: Partial<Record<Sky, { n: number; v: [number, number]; len: [number, number]; wind: number; a: number }>> = {
  drizzle: { n: 60, v: [4, 6], len: [4, 6], wind: -0.4, a: 0.5 },
  rain: { n: 140, v: [8, 11], len: [8, 14], wind: -1.2, a: 0.6 },
  heavy: { n: 260, v: [12, 16], len: [12, 20], wind: -2.2, a: 0.65 },
  storm: { n: 240, v: [12, 16], len: [12, 20], wind: -2.8, a: 0.65 },
};
/** 눈: 송이 수, 내려오는 빠르기, 바람 */
const SNOW: Partial<Record<Sky, { n: number; v: [number, number]; wind: number }>> = {
  snow: { n: 80, v: [0.5, 1.2], wind: 0.15 },
  blizzard: { n: 200, v: [1, 2.2], wind: 1.4 },
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** 도트 한 칸 (px) */
const P = 2;
const snap = (v: number) => Math.round(v / P) * P;

export function WeatherFx({ sky }: { sky: Sky }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let w = 0;
    let h = 0;
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    };
    size();
    window.addEventListener("resize", size);
    const area = () => Math.max(0.5, (w * h) / (400 * 800));

    const rain = RAIN[sky];
    const snow = SNOW[sky];
    type Drop = { x: number; y: number; v: number; len: number };
    type Flake = { x: number; y: number; v: number; s: number; ph: number; f: number };
    const drops: Drop[] = [];
    const flakes: Flake[] = [];
    const newDrop = (top: boolean): Drop => ({
      x: rnd(0, w + 60),
      y: top ? rnd(-h * 0.3, -10) : rnd(-20, h),
      v: rnd(...rain!.v),
      len: rnd(...rain!.len),
    });
    const newFlake = (top: boolean): Flake => ({
      x: rnd(-20, w + 20),
      y: top ? rnd(-40, -4) : rnd(-20, h),
      v: rnd(...snow!.v),
      s: Math.random() < 0.18 ? 3 : Math.random() < 0.5 ? 2 : 1, // 1·2: 네모, 3: 십자 송이
      ph: rnd(0, Math.PI * 2),
      f: rnd(0.01, 0.03),
    });
    if (rain) for (let i = 0; i < rain.n * area(); i++) drops.push(newDrop(false));
    if (snow) for (let i = 0; i < snow.n * area(); i++) flakes.push(newFlake(false));

    // 천둥번개: 5~12초마다 번쩍 (두 번), 처음 잠깐 도트 번개 줄기
    let flash = 0;
    let nextFlash = performance.now() + rnd(1500, 4000);
    let bolt: [number, number][] = [];
    const makeBolt = () => {
      bolt = [];
      let x = snap(rnd(w * 0.15, w * 0.85));
      let y = 0;
      const end = rnd(h * 0.25, h * 0.45);
      while (y < end) {
        bolt.push([x, y]);
        y += 4;
        if (Math.random() < 0.35) x += (Math.random() < 0.5 ? -4 : 4);
      }
    };
    // 안개: 천천히 흐르는 옅은 띠
    const bands = sky === "fog" ? [0.22, 0.48, 0.74].map((y) => ({ y, x: rnd(-1, 0), v: rnd(0.0003, 0.0007), a: rnd(0.12, 0.18) })) : [];

    let last = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const k = Math.min(3, (now - last) / 16.7); // 60fps 기준 한 칸
      last = now;
      ctx.clearRect(0, 0, w, h);
      // 폭우·천둥은 조금 어둡게
      if (sky === "heavy" || sky === "storm") {
        ctx.fillStyle = "rgba(6, 8, 24, 0.16)";
        ctx.fillRect(0, 0, w, h);
      }
      if (rain) {
        ctx.fillStyle = `rgba(165, 205, 255, ${rain.a})`;
        for (const d of drops) {
          d.y += d.v * k;
          d.x += rain.wind * k;
          if (d.y > h || d.x < -20) Object.assign(d, newDrop(true));
          // 도트 빗줄기: 위 반은 바람 쪽으로 한 칸 옮겨 비스듬히
          const x = snap(d.x);
          const y = snap(d.y);
          const half = snap(d.len / 2);
          ctx.fillRect(x - (rain.wind < -1 ? P : 0), y, P, half);
          ctx.fillRect(x, y + half, P, half);
        }
      }
      if (snow) {
        for (const f of flakes) {
          f.ph += f.f * k;
          f.y += f.v * k;
          f.x += (snow.wind + Math.sin(f.ph) * 0.6) * k;
          if (f.y > h + 6 || f.x > w + 24 || f.x < -24) Object.assign(f, newFlake(true));
          const x = snap(f.x);
          const y = snap(f.y);
          ctx.fillStyle = f.s === 3 ? "rgba(255, 255, 255, 0.9)" : f.s === 2 ? "rgba(240, 246, 255, 0.8)" : "rgba(230, 238, 255, 0.6)";
          if (f.s === 3) {
            ctx.fillRect(x - P, y, P * 3, P);
            ctx.fillRect(x, y - P, P, P * 3);
          } else ctx.fillRect(x, y, P * f.s, P * f.s);
        }
      }
      for (const b of bands) {
        b.x += b.v * k;
        if (b.x > 1) b.x = -1;
        // 가로로 긴 타원 (가장자리까지 옅어져 테두리가 안 보이게)
        const cx = b.x * w * 1.6 + w / 2;
        ctx.save();
        ctx.translate(cx, b.y * h);
        ctx.scale(1, 0.32);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.95);
        g.addColorStop(0, `rgba(205, 210, 235, ${b.a})`);
        g.addColorStop(0.6, `rgba(205, 210, 235, ${b.a * 0.45})`);
        g.addColorStop(1, "rgba(205, 210, 235, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(-w, -w, w * 2, w * 2);
        ctx.restore();
      }
      if (sky === "storm") {
        if (now > nextFlash) {
          flash = 1;
          makeBolt();
          // 두 번째 번쩍은 0.15초 뒤
          window.setTimeout(() => (flash = Math.max(flash, 0.7)), 150);
          nextFlash = now + rnd(5000, 12000);
        }
        if (flash > 0) {
          if (flash > 0.75 && bolt.length) {
            ctx.fillStyle = "rgba(255, 250, 220, 0.95)";
            for (const [x, y] of bolt) ctx.fillRect(x, y, 4, 4);
          }
          ctx.fillStyle = `rgba(235, 240, 255, ${flash * 0.28})`;
          ctx.fillRect(0, 0, w, h);
          flash = Math.max(0, flash - 0.06 * k);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    // 다른 앱·탭에 가 있으면 멈춘다
    const vis = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState === "visible") {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [sky]);
  return <canvas className="wx-fx" ref={ref} aria-hidden />;
}

/**
 * 홈의 날씨: 아직 안 정했으면 '화면에 우리 동네 날씨를 반영하는 기능이 생겼어요 [켜기] [나중에]' ('화면 꾸미기' 같은 말은 쓰지 않는다,
 * 제작자 2026-11-02), 켜면 아래 가운데 작은 날씨 표('🌧️ 비 12°')와 효과. 못 받았으면 '위치를 못 받았어요 ↻' / '날씨 연결이 안 돼요 ↻',
 * 누르면 다시 받는다. 초안이라 앱개발자와 테스트 계정만 (WEATHER_OPEN). 그동안 날씨 표를 누르면 효과를 하나씩 미리 본다 (마지막 다음은 실제 날씨)
 */
export function HomeWeather({ me }: { me: Me }) {
  const allowed = WEATHER_OPEN || me.role === "developer" || TEST_IDS.includes(me.id);
  const wx = useWeather(allowed);
  const [preview, setPreview] = useState<number>(-1);
  if (!allowed) return null;
  const real = wx.state.status === "on" ? wx.state.weather : null;
  const sky: Sky | null = preview >= 0 ? PREVIEW[preview] : real?.sky ?? null;
  const failed = wx.state.status === "error" && preview < 0 ? wx.state : null;
  const next = () => (failed ? wx.retry() : setPreview((p) => (p + 1 >= PREVIEW.length ? -1 : p + 1)));
  return (
    <>
      {sky && <WeatherFx key={sky} sky={sky} />}
      {wx.state.status === "ask" && (
        <div className="panel wx-ask">
          <span>🌦️ 화면에 우리 동네 날씨를 반영하는 기능이 생겼어요</span>
          <button className="pill pill-on" onClick={wx.enable}>
            켜기
          </button>
          <button className="pill" onClick={wx.later}>
            나중에
          </button>
        </div>
      )}
      <button className="home-weather" onClick={next} title={failed ? `${failed.reason} · 눌러서 다시` : "눌러서 날씨 효과 미리 보기 (초안)"}>
        {preview >= 0
          ? `${skyIcon(PREVIEW[preview])} 미리 보기 · ${SKY_NAME[PREVIEW[preview]]}`
          : real
            ? `${skyIcon(real.sky, real.day)} ${SKY_NAME[real.sky]}${real.temp !== null ? ` ${real.temp}°` : ""}`
            : wx.state.status === "loading"
              ? "날씨 받는 중…"
              : failed
                ? failed.kind === "loc"
                  ? "위치를 못 받았어요 ↻"
                  : "날씨 연결이 안 돼요 ↻"
                : "🌦️ 날씨 미리 보기"}
      </button>
    </>
  );
}
