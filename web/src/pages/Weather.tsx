// 홈 화면의 날씨 효과 (제작자 요청 2026-11-02 초안, src/weather.ts): 내 지역이 비면 가는 비(아래 탭 위 선에 닿으면 작게 퐁당 튀고 그 선에 빗물이 고인다),
// 눈이면 눈(그 선 위에 소복이 쌓인다). 폭우·천둥번개도 가는 비로 (화면을 가려서 뺐다).
// 앱의 도트 그림과 맞게 네모 픽셀로 그린다. 화면을 누르는 데는 걸리지 않고(pointer-events: none), 다른 앱에 가 있으면 멈추고,
// 움직임 줄이기면 그리지 않는다. App.tsx 가 홈일 때 <main> 밖에 그린다 (.page 의 transform 안이면 위에서 내려온다)
import { useEffect, useRef, useState } from "react";
import type { Me } from "../auth";
import { TEST_IDS } from "../auth";
import { PREVIEW, SKY_NAME, WEATHER_OPEN, skyIcon, useWeather } from "../weather";
import type { Sky } from "../weather";

/**
 * 비: 한 화면(400x800)에 몇 줄기, 빠르기(px/frame), 길이, 바람(px/frame), 진하기.
 * 비·폭우·천둥번개도 모두 가는 비 하나로 (제작자 요청 2026-11-02: '비 폭우 천둥번개 없애, 화면 너무 가림'. 어둡게 하기와 번개도 뺐다)
 */
const LIGHT_RAIN = { n: 55, v: [6, 8] as [number, number], len: [6, 10] as [number, number], wind: -0.6, a: 0.45 };
const RAIN: Partial<Record<Sky, typeof LIGHT_RAIN>> = {
  drizzle: { ...LIGHT_RAIN, n: 40, v: [5, 7], len: [4, 7], a: 0.4 },
  rain: LIGHT_RAIN,
  heavy: LIGHT_RAIN,
  storm: LIGHT_RAIN,
};
/**
 * 눈: 송이 수, 내려오는 빠르기, 바람, 큰 송이 비율, 쌓이는 빠르기(송이 하나가 쌓는 높이 px).
 * 함박눈은 바람에 날리는 눈보라가 아니라 큰 송이가 화면 가득 천천히 내리는 것 (제작자 2026-11-02: 오른쪽으로 쏠려 머리카락처럼 꺾였다, 화면 전체가 채워져야지)
 */
const SNOW: Partial<Record<Sky, { n: number; v: [number, number]; wind: number; big: number; grow: number }>> = {
  // 그냥 눈도 함박눈처럼 쌓이게 송이 하나가 쌓는 양을 3배로 (제작자 요청 2026-11-02 '그냥 눈은 왜 안 쌓임 함박눈처럼 해')
  snow: { n: 90, v: [0.5, 1.2], wind: 0.1, big: 0.12, grow: 3 },
  blizzard: { n: 170, v: [0.7, 1.6], wind: 0.2, big: 0.4, grow: 1 },
};
/**
 * 아래 탭 위 선에 고이는 빗물 (제작자 요청 2026-11-02: '그 선에 물이 받아지는 느낌, 함박눈처럼'): 빗방울 하나가 이만큼(px) 물을 더하고,
 * 물은 옆으로 퍼져 수평이 되며 WATER_MAX(px)까지 천천히 차오른다
 */
const DROP_WATER = 2;
const WATER_MAX = 10;
/** 아래 탭 위 선에 쌓이는 눈의 가장 높은 곳 (도트 칸 수, 한 칸 2px). 그 위로는 더 안 쌓인다 */
const PILE_MAX = 20;
/**
 * 눈송이 크기마다 쌓이는 도트 (가운데 칸을 0 으로 옆 칸까지): 닿는 그 순간 그 자리에 한 톨씩 보이게 쌓인다
 * (제작자 요청 2026-11-02: '1분 말고 실시간으로 눈 한 톨 한 톨 점점 쌓이게')
 */
const FLAKE_CELLS: Record<number, [number, number][]> = {
  1: [[0, 1]],
  2: [[0, 1], [1, 1]],
  3: [[-1, 1], [0, 2], [1, 1]],
  4: [[-2, 1], [-1, 2], [0, 3], [1, 2], [2, 1]],
};

/** 효과가 있는 날씨 (맑음·흐림·안개는 그리지 않는다. 안개는 제작자 요청 2026-11-02 '안개 있으면 빼'로 뺐다) */
const hasFx = (sky: Sky) => !!(RAIN[sky] || SNOW[sky]);

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** 도트 한 칸 (px) */
const P = 2;
const snap = (v: number) => Math.round(v / P) * P;

/**
 * 쌓인 눈 (도트 한 칸 폭마다 높이). 홈을 나갔다 와도 이번에 연 동안은 그대로 이어서 쌓인다 (제작자 요청 2026-11-02: 계속 보고 있으면 계속 쌓이게).
 * 눈이 아닌 날씨가 되면 지운다
 */
let pileMemo: { w: number; h: number[] } | null = null;
/** 고인 빗물 (도트 한 칸 폭마다 높이 px). 쌓인 눈처럼 이번에 연 동안은 이어지고 비가 아니게 되면 지운다 */
let waterMemo: { w: number; h: number[] } | null = null;

export function WeatherFx({ sky }: { sky: Sky }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const rain = RAIN[sky];
    const snow = SNOW[sky];
    if (!snow) pileMemo = null;
    if (!rain) waterMemo = null;
    let w = 0;
    let h = 0;
    /** 아래 탭 위 선 (빗방울이 튀고 눈이 쌓이는 곳). 탭이 없으면 화면 맨 아래 */
    let ground = 0;
    let cols = 0;
    let pile: number[] = [];
    let water: number[] = [];
    const measure = () => {
      const bar = document.querySelector(".tabbar");
      ground = bar ? Math.round(bar.getBoundingClientRect().top) : h;
    };
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      measure();
      cols = Math.ceil(w / P);
      if (snow) {
        // 폭이 그대로면 쌓아 둔 눈을 이어서
        pile = pileMemo && pileMemo.w === cols ? pileMemo.h : new Array(cols).fill(0);
        pileMemo = { w: cols, h: pile };
      }
      if (rain) {
        water = waterMemo && waterMemo.w === cols ? waterMemo.h : new Array(cols).fill(0);
        waterMemo = { w: cols, h: water };
      }
    };
    size();
    window.addEventListener("resize", size);
    // 키보드나 화면 배치가 바뀌어 탭 위치가 바뀌는 때를 위해 가끔 다시 잰다
    const remeasure = window.setInterval(measure, 2000);
    const area = () => Math.max(0.5, (w * ground) / (400 * 800));

    type Drop = { x: number; y: number; v: number; len: number };
    type Flake = { x: number; y: number; v: number; s: number; ph: number; f: number };
    /** 빗방울이 선에 닿아 튀는 작은 물방울 */
    type Bit = { x: number; y: number; vx: number; vy: number; life: number };
    /** 닿은 자리(물 위)의 짧은 잔물결 */
    type Ring = { x: number; y: number; life: number };
    const drops: Drop[] = [];
    const flakes: Flake[] = [];
    const bits: Bit[] = [];
    const rings: Ring[] = [];
    const newDrop = (top: boolean): Drop => ({
      x: rnd(0, w),
      y: top ? rnd(-ground * 0.3, -10) : rnd(-20, ground),
      v: rnd(...rain!.v),
      len: rnd(...rain!.len),
    });
    const newFlake = (top: boolean): Flake => {
      // 1·2: 작은 네모, 3: 십자 송이, 4: 큰 송이 (가운데 네모와 팔). 큰 송이일수록 천천히
      const s = Math.random() < snow!.big ? (Math.random() < 0.5 ? 4 : 3) : Math.random() < 0.5 ? 2 : 1;
      return {
        x: rnd(0, w),
        y: top ? rnd(-40, -4) : rnd(-20, ground),
        v: rnd(...snow!.v) * (s === 4 ? 0.75 : 1),
        s,
        ph: rnd(0, Math.PI * 2),
        f: rnd(0.01, 0.03),
      };
    };
    if (rain) for (let i = 0; i < rain.n * area(); i++) drops.push(newDrop(false));
    if (snow) for (let i = 0; i < snow.n * area(); i++) flakes.push(newFlake(false));

    /** 빗방울이 물(선)에 닿으면 작게 퐁당: 양옆 위로 튀는 물방울 둘과 짧은 잔물결 (제작자 2026-11-02: 크게 튀는 것은 너무 두꺼워 되돌렸다) */
    const splash = (x: number, y: number) => {
      if (bits.length > 120) return;
      for (let i = 0; i < 2; i++) bits.push({ x, y: y - P, vx: rnd(0.4, 1.2) * (i ? 1 : -1), vy: rnd(-2.6, -1.6), life: 1 });
      rings.push({ x, y, life: 1 });
    };
    /** 빗물 더하기 (닿은 칸에) */
    const pour = (x: number) => {
      const c = Math.floor(x / P);
      if (c >= 0 && c < cols && water[c] < WATER_MAX) water[c] = Math.min(WATER_MAX + 2, water[c] + DROP_WATER);
    };
    /** 물은 옆으로 퍼져 수평이 된다 (양옆과의 높이 차를 조금씩 나눈다. 전체 물의 양은 그대로) */
    const flow = () => {
      for (let pass = 0; pass < 3; pass++) {
        let prev = water[0];
        for (let c = 0; c < cols; c++) {
          const cur = water[c];
          const l = c > 0 ? prev : cur;
          const r = c < cols - 1 ? water[c + 1] : cur;
          prev = cur;
          water[c] = cur + 0.24 * (l + r - 2 * cur);
        }
      }
    };
    /** 눈송이가 닿으면 그 자리에 그 송이만큼 도트를 바로 얹는다 (한 톨 한 톨 보이게) */
    const land = (x: number, size: number) => {
      const c0 = Math.floor(x / P);
      for (const [dx, n] of FLAKE_CELLS[size]) {
        const c = c0 + dx;
        if (c >= 0 && c < cols) pile[c] = Math.min(PILE_MAX, pile[c] + n * snow!.grow);
      }
    };
    /** 옆 칸보다 두 칸 넘게 높으면 맨 위 한 톨이 낮은 쪽으로 굴러 내린다 (뾰족하지 않은 둔덕). 매번 방향을 바꿔 한쪽으로 쏠리지 않게 */
    let sweep = 1;
    const settle = () => {
      sweep = -sweep;
      for (let i = 0; i < cols; i++) {
        const c = sweep > 0 ? i : cols - 1 - i;
        const l = c > 0 ? pile[c - 1] : Infinity;
        const r = c < cols - 1 ? pile[c + 1] : Infinity;
        const low = l < r ? c - 1 : l > r ? c + 1 : Math.random() < 0.5 ? c - 1 : c + 1;
        if (low >= 0 && low < cols && pile[c] - pile[low] >= 2) {
          pile[c]--;
          pile[low]++;
        }
      }
    };

    let last = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const k = Math.min(3, (now - last) / 16.7); // 60fps 기준 한 칸
      last = now;
      ctx.clearRect(0, 0, w, h);
      if (rain) {
        ctx.fillStyle = `rgba(165, 205, 255, ${rain.a})`;
        for (const d of drops) {
          d.y += d.v * k;
          d.x += rain.wind * k;
          // 바람에 왼쪽으로 나가면 오른쪽에서 이어서 (한쪽이 비지 않게 화면 전체에 고르게)
          if (d.x < -20) d.x += w + 40;
          const wc = Math.max(0, Math.min(cols - 1, Math.floor(d.x / P)));
          const surface = ground - snap(water[wc] ?? 0);
          if (d.y + d.len >= surface) {
            splash(snap(d.x), surface);
            pour(d.x);
            Object.assign(d, newDrop(true));
            continue;
          }
          const x = snap(d.x);
          const y = snap(d.y);
          const half = snap(d.len / 2);
          ctx.fillRect(x, y, P, half);
          ctx.fillRect(x, y + half, P, half);
        }
        // 고인 빗물: 옆으로 퍼져 수평이 되고 조금씩 차오른다. 수면 한 줄은 밝게, 천천히 반짝인다
        flow();
        const t = now / 600;
        for (let c = 0; c < cols; c++) {
          // 조금이라도 고이면 한 줄은 보이게
          if (water[c] < 0.5) continue;
          const wh = Math.max(P, snap(water[c]));
          const x = c * P;
          ctx.fillStyle = "rgba(110, 165, 235, 0.42)";
          ctx.fillRect(x, ground - wh, P, wh);
          ctx.fillStyle = `rgba(200, 228, 255, ${0.55 + 0.35 * Math.sin(t + c * 0.35)})`;
          ctx.fillRect(x, ground - wh, P, P);
        }
        // 튀는 물방울: 조금 튀었다가 떨어지며 흐려진다
        ctx.fillStyle = "rgba(210, 232, 255, 1)";
        for (let i = bits.length - 1; i >= 0; i--) {
          const b = bits[i];
          b.x += b.vx * k;
          b.y += b.vy * k;
          b.vy += 0.3 * k;
          b.life -= 0.05 * k;
          if (b.life <= 0 || b.y > ground) {
            bits.splice(i, 1);
            continue;
          }
          ctx.globalAlpha = Math.min(1, b.life * 1.3);
          ctx.fillRect(snap(b.x), snap(b.y), P, P);
        }
        // 잔물결: 닿은 자리 수면에서 양옆으로 짧게
        for (let i = rings.length - 1; i >= 0; i--) {
          const r = rings[i];
          r.life -= 0.06 * k;
          if (r.life <= 0) {
            rings.splice(i, 1);
            continue;
          }
          const spread = snap((1 - r.life) * 6) + P;
          ctx.globalAlpha = Math.min(1, r.life);
          ctx.fillRect(r.x - spread - P, r.y - P, P * 2, P);
          ctx.fillRect(r.x + spread, r.y - P, P * 2, P);
        }
        ctx.globalAlpha = 1;
      }
      if (snow) {
        for (const f of flakes) {
          f.ph += f.f * k;
          f.y += f.v * k;
          f.x += (snow.wind + Math.sin(f.ph) * 0.5) * k;
          // 옆으로 나가면 반대편에서 같은 높이로 이어서 (예전에는 위에서 다시 떨어져 한쪽으로 쏠렸다)
          if (f.x > w + 24) f.x -= w + 48;
          else if (f.x < -24) f.x += w + 48;
          // 쌓인 눈 위에 닿으면 소복이 쌓인다 (큰 송이는 더)
          const c = Math.max(0, Math.min(cols - 1, Math.floor(f.x / P)));
          if (f.x >= 0 && f.x < w && f.y >= ground - pile[c] * P - P) {
            land(f.x, f.s);
            Object.assign(f, newFlake(true));
            continue;
          }
          if (f.y > ground + 8) Object.assign(f, newFlake(true));
          const x = snap(f.x);
          const y = snap(f.y);
          ctx.fillStyle = f.s >= 3 ? "rgba(255, 255, 255, 0.92)" : f.s === 2 ? "rgba(240, 246, 255, 0.8)" : "rgba(230, 238, 255, 0.6)";
          if (f.s === 4) {
            ctx.fillRect(x - P, y - P, P * 3, P * 3);
            ctx.fillRect(x - P * 2, y, P * 5, P);
            ctx.fillRect(x, y - P * 2, P, P * 5);
          } else if (f.s === 3) {
            ctx.fillRect(x - P, y, P * 3, P);
            ctx.fillRect(x, y - P, P, P * 3);
          } else ctx.fillRect(x, y, P * f.s, P * f.s);
        }
        settle();
        // 쌓인 눈: 칸마다 도트로 (맨 위 한 칸은 더 밝게, 맨 아래는 살짝 푸르게)
        for (let c = 0; c < cols; c++) {
          const ph = pile[c] * P;
          if (!ph) continue;
          const x = c * P;
          ctx.fillStyle = "rgba(226, 234, 255, 0.95)";
          ctx.fillRect(x, ground - ph, P, ph);
          ctx.fillStyle = "rgba(255, 255, 255, 1)";
          ctx.fillRect(x, ground - ph, P, P);
          if (ph > P * 2) {
            ctx.fillStyle = "rgba(176, 196, 240, 0.6)";
            ctx.fillRect(x, ground - P, P, P);
          }
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
      window.clearInterval(remeasure);
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
/** 날씨 기능을 쓰는 사람 (초안: 앱개발자와 테스트 계정, 열면 모두) */
export const canUseWeather = (me: Me) => WEATHER_OPEN || me.role === "developer" || TEST_IDS.includes(me.id);

export function HomeWeather({ me }: { me: Me }) {
  const allowed = canUseWeather(me);
  const wx = useWeather(allowed);
  const [preview, setPreview] = useState<number>(-1);
  if (!allowed) return null;
  const real = wx.state.status === "on" ? wx.state.weather : null;
  const sky: Sky | null = preview >= 0 ? PREVIEW[preview] : real?.sky ?? null;
  const failed = wx.state.status === "error" && preview < 0 ? wx.state : null;
  const next = () => (failed ? wx.retry() : setPreview((p) => (p + 1 >= PREVIEW.length ? -1 : p + 1)));
  return (
    <>
      {sky && hasFx(sky) && <WeatherFx key={sky} sky={sky} />}
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
