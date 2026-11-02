// 홈 화면의 날씨 효과 (제작자 요청 2026-11-02 초안, src/weather.ts): 내 지역이 비면 비, 눈이면 눈, 천둥이면 번개.
// 앱의 도트 그림과 맞게 네모 픽셀로 그린다. 비가 오면 아래 탭 위에 물이 조금씩 차오르고(빗방울이 튄다), 눈이 오면 눈이 쌓인다
// (제작자 요청 2026-11-02). 쌓인 것은 이 창이 열려 있는 동안 다른 화면에 갔다 와도 남는다.
// 화면을 누르는 데는 걸리지 않고(pointer-events: none), 다른 앱에 가 있으면 멈추고, 움직임 줄이기면 그리지 않는다.
// App.tsx 가 홈일 때 <main> 밖에 그린다 (.page 의 transform 안이면 위에서 내려온다)
import { useEffect, useRef, useState } from "react";
import type { Me } from "../auth";
import { TEST_IDS } from "../auth";
import { PREVIEW, SKY_NAME, WEATHER_OPEN, skyIcon, useWeather } from "../weather";
import type { Sky } from "../weather";

/** 비: 한 화면(400x800)에 몇 줄기, 빠르기(px/frame), 길이, 바람(px/frame), 진하기, 물이 차오르는 끝(px) */
const RAIN: Partial<Record<Sky, { n: number; v: [number, number]; len: [number, number]; wind: number; a: number; pool: number }>> = {
  drizzle: { n: 60, v: [4, 6], len: [4, 6], wind: -0.4, a: 0.5, pool: 4 },
  rain: { n: 140, v: [8, 11], len: [8, 14], wind: -1.2, a: 0.6, pool: 10 },
  heavy: { n: 260, v: [12, 16], len: [12, 20], wind: -2.2, a: 0.65, pool: 16 },
  storm: { n: 240, v: [12, 16], len: [12, 20], wind: -2.8, a: 0.65, pool: 16 },
};
/** 눈: 송이 수, 내려오는 빠르기, 바람, 쌓이는 끝(px) */
const SNOW: Partial<Record<Sky, { n: number; v: [number, number]; wind: number; pile: number }>> = {
  snow: { n: 80, v: [0.5, 1.2], wind: 0.15, pile: 14 },
  blizzard: { n: 200, v: [1, 2.2], wind: 1.4, pile: 22 },
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** 도트 한 칸 (px) */
const P = 2;
const snap = (v: number) => Math.round(v / P) * P;

/** 쌓인 눈(2px 칸마다 높이)과 고인 물 높이: 다른 화면에 갔다 와도 이어지게 이 창이 열려 있는 동안 둔다 (화면 폭이 바뀌면 처음부터) */
const ground = { w: 0, snow: null as Float32Array | null, water: 0 };

export function WeatherFx({ sky }: { sky: Sky }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let w = 0;
    let h = 0;
    /** 바닥: 아래 탭 바로 위 (효과는 아래 탭 밑에 깔려서, 쌓인 것이 탭 위에 보이게) */
    let floor = 0;
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const bar = document.querySelector(".tabbar")?.getBoundingClientRect();
      floor = bar && bar.top > h * 0.5 ? Math.round(bar.top) : h;
      if (ground.w !== w) {
        ground.w = w;
        ground.snow = null;
        ground.water = 0;
      }
    };
    size();
    window.addEventListener("resize", size);
    const area = () => Math.max(0.5, (w * h) / (400 * 800));

    const rain = RAIN[sky];
    const snow = SNOW[sky];
    const cols = Math.ceil(w / P) + 1;
    if (snow && (!ground.snow || ground.snow.length !== cols)) ground.snow = new Float32Array(cols);
    const pile = ground.snow;
    type Drop = { x: number; y: number; v: number; len: number };
    type Flake = { x: number; y: number; v: number; s: number; ph: number; f: number };
    type Splash = { x: number; y: number; vx: number; vy: number; life: number };
    const drops: Drop[] = [];
    const flakes: Flake[] = [];
    const splashes: Splash[] = [];
    // 새로 나올 때는 화면 폭 전체에 고르게, 옆으로 나가면 반대편에서 다시 들어온다
    // (제작자 2026-11-02: 함박눈이 한 방향으로 흘러 빈 곳이 생겼다)
    const newDrop = (top: boolean): Drop => ({
      x: rnd(0, w),
      y: top ? rnd(-h * 0.3, -10) : rnd(-20, floor),
      v: rnd(...rain!.v),
      len: rnd(...rain!.len),
    });
    const newFlake = (top: boolean): Flake => ({
      x: rnd(0, w),
      y: top ? rnd(-40, -4) : rnd(-20, floor),
      v: rnd(...snow!.v),
      s: Math.random() < 0.18 ? 3 : Math.random() < 0.5 ? 2 : 1, // 1·2: 네모, 3: 십자 송이
      ph: rnd(0, Math.PI * 2),
      f: rnd(0.01, 0.03),
    });
    const wrapX = (x: number) => (x < -8 ? x + w + 16 : x > w + 8 ? x - w - 16 : x);
    if (rain) for (let i = 0; i < rain.n * area(); i++) drops.push(newDrop(false));
    if (snow) for (let i = 0; i < snow.n * area(); i++) flakes.push(newFlake(false));

    /** 눈 한 송이가 내려앉는다: 그 칸을 높이고, 옆 칸보다 너무 높으면 흘러내린다 */
    const land = (x: number, amount: number) => {
      if (!pile || !snow) return;
      let c = Math.max(0, Math.min(pile.length - 1, Math.floor(x / P)));
      if (pile[c] >= snow.pile) return;
      pile[c] += amount;
      for (let k = 0; k < 6; k++) {
        const l = c > 0 ? pile[c - 1] : Infinity;
        const r = c < pile.length - 1 ? pile[c + 1] : Infinity;
        const to = l < r ? c - 1 : c + 1;
        if (pile[c] - Math.min(l, r) <= P) break;
        pile[c] -= P / 2;
        pile[to] += P / 2;
        c = to;
      }
    };

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
        if (Math.random() < 0.35) x += Math.random() < 0.5 ? -4 : 4;
      }
    };

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
        const surface = floor - ground.water;
        ctx.fillStyle = `rgba(165, 205, 255, ${rain.a})`;
        for (const d of drops) {
          d.y += d.v * k;
          d.x = wrapX(d.x + rain.wind * k);
          if (d.y + d.len >= surface) {
            // 물에 닿으면 튀고, 물이 조금 찬다
            if (splashes.length < 90 && Math.random() < 0.6)
              for (let s = 0; s < 2; s++) splashes.push({ x: d.x, y: surface - P, vx: rnd(-1.2, 1.2), vy: rnd(-2.6, -1.2), life: rnd(10, 18) });
            if (ground.water < rain.pool) ground.water = Math.min(rain.pool, ground.water + 0.0013 * (rain.pool / 10));
            Object.assign(d, newDrop(true));
            continue;
          }
          // 도트 빗줄기: 위 반은 바람 쪽으로 한 칸 옮겨 비스듬히
          const x = snap(d.x);
          const y = snap(d.y);
          const half = snap(d.len / 2);
          ctx.fillRect(x - (rain.wind < -1 ? P : 0), y, P, half);
          ctx.fillRect(x, y + half, P, half);
        }
        // 튀는 물방울
        ctx.fillStyle = "rgba(190, 220, 255, 0.75)";
        for (let i = splashes.length - 1; i >= 0; i--) {
          const s = splashes[i];
          s.x += s.vx * k;
          s.y += s.vy * k;
          s.vy += 0.25 * k;
          s.life -= k;
          if (s.life <= 0 || s.y > surface) splashes.splice(i, 1);
          else ctx.fillRect(snap(s.x), snap(s.y), P, P);
        }
        // 고인 물: 바닥에서 차오르는 옅은 파란 띠와 출렁이는 도트 물결
        const lv = snap(ground.water);
        if (lv >= P) {
          ctx.fillStyle = "rgba(70, 120, 220, 0.4)";
          ctx.fillRect(0, floor - lv, w, lv);
          ctx.fillStyle = "rgba(170, 210, 255, 0.55)";
          for (let x = 0; x < w; x += P) {
            const off = Math.sin(x * 0.07 + now * 0.004) + Math.sin(x * 0.023 - now * 0.0025);
            ctx.fillRect(x, floor - lv + snap(off) - P, P, P);
          }
        }
      }
      if (snow) {
        for (const f of flakes) {
          f.ph += f.f * k;
          f.y += f.v * k;
          f.x = wrapX(f.x + (snow.wind + Math.sin(f.ph) * 0.6) * k);
          // 쌓인 눈에 닿으면 내려앉는다
          const c = Math.max(0, Math.min((pile?.length ?? 1) - 1, Math.floor(f.x / P)));
          if (f.y >= floor - (pile?.[c] ?? 0) - P) {
            land(f.x, f.s === 3 ? 3 : f.s === 2 ? 2 : 1.4);
            Object.assign(f, newFlake(true));
            continue;
          }
          const x = snap(f.x);
          const y = snap(f.y);
          ctx.fillStyle = f.s === 3 ? "rgba(255, 255, 255, 0.9)" : f.s === 2 ? "rgba(240, 246, 255, 0.8)" : "rgba(230, 238, 255, 0.6)";
          if (f.s === 3) {
            ctx.fillRect(x - P, y, P * 3, P);
            ctx.fillRect(x, y - P, P, P * 3);
          } else ctx.fillRect(x, y, P * f.s, P * f.s);
        }
        // 쌓인 눈: 칸마다 흰 도트, 맨 윗칸은 더 밝게
        if (pile) {
          for (let c = 0; c < pile.length; c++) {
            const ht = snap(pile[c]);
            if (ht < P) continue;
            ctx.fillStyle = "rgba(228, 236, 252, 0.92)";
            ctx.fillRect(c * P, floor - ht, P, ht);
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(c * P, floor - ht, P, P);
          }
        }
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
 * 홈의 날씨: 내 정보에서 '날씨 효과'를 켜고 위치를 허용했을 때만 효과와 아래 가운데 작은 날씨 표('🌧️ 비 12°').
 * 초안이라 앱개발자와 테스트 계정만 (WEATHER_OPEN). 그동안 날씨 표를 누르면 효과를 하나씩 미리 본다 (마지막 다음은 실제 날씨)
 */
export function HomeWeather({ me }: { me: Me }) {
  const allowed = WEATHER_OPEN || me.role === "developer" || TEST_IDS.includes(me.id);
  const state = useWeather(allowed);
  const [preview, setPreview] = useState<number>(-1);
  if (!allowed || state.status !== "on") return null;
  const real = state.weather;
  const sky: Sky = preview >= 0 ? PREVIEW[preview] : real.sky;
  const preview_ = me.role === "developer" || TEST_IDS.includes(me.id);
  const next = () => setPreview((p) => (p + 1 >= PREVIEW.length ? -1 : p + 1));
  return (
    <>
      {sky !== "clear" && sky !== "cloud" && <WeatherFx key={sky} sky={sky} />}
      <button className="home-weather" onClick={preview_ ? next : undefined} title={preview_ ? "눌러서 날씨 효과 미리 보기" : undefined}>
        {preview >= 0
          ? `${skyIcon(PREVIEW[preview])} 미리 보기 · ${SKY_NAME[PREVIEW[preview]]}`
          : `${skyIcon(real.sky, real.day)} ${SKY_NAME[real.sky]}${real.temp !== null ? ` ${real.temp}°` : ""}`}
      </button>
    </>
  );
}
