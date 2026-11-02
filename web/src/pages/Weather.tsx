// 홈 화면의 날씨 효과 (제작자 요청 2026-11-02 초안, src/weather.ts): 내 지역이 비면 가는 비(아래 탭 위 선에 닿으면 작게 퐁당 튀고, 튄 도트가 떨어져 남아 좌우로 번지며 고인다),
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
 * 아래 탭 위 선에 고이는 빗물 (제작자 요청 2026-11-02: '퐁당거리는 그 도트가 땅에 남아서 점점 좌우로 퍼지면 되잖아, 물처럼'):
 * 빗방울 자리에 한 칸, 튄 물방울 도트도 떨어지면 다 그 자리에 남고, 옆으로 흘러 퍼져 한 줄씩 차오른다 (한 칸 2px).
 * 홈에서 몇 초 안에 차오르게 (제작자 요청 2026-11-02 '좀 더 빨리 팍팍, 절반 남기지 말고 다 남겨, 누가 홈 화면에서 1분이나 멍때리냐')
 */
const KEEP = 1;
/**
 * 눈과 빗물은 화면 맨 위까지 계속 쌓이고 차오른다 (제작자 요청 2026-11-02 '비와 눈은 화면 맨 위까지 꽉 차게 해, 잠수 타면').
 * 화면을 IDLE_MS 넘게 안 만지면(잠수) IDLE_BOOST 배로 빨리 쌓인다. 효과는 누르는 데 걸리지 않아서 꽉 차도 홈 칸은 그대로 눌린다
 */
/** 평소에도 이만큼 한 번에 쌓고, 화면을 IDLE_MS 넘게 안 만지면 IDLE_BOOST 배 더 (제작자 요청 2026-11-02 '좀 더 차는 속도 빠르게, 한국인 성격 급함') */
const BASE = 2;
const IDLE_MS = 8_000;
const IDLE_BOOST = 5;
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
    // 바닥은 아래 탭 위의 밝은 선(.tabbar 의 box-shadow, --px 두께) 위 (2026-11-02 제작자 폰: 바닥 한 줄이 그 선에 가려 빗물이 하나도 안 보였다)
    const line = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--px")) || 2;
    const measure = () => {
      const bar = document.querySelector(".tabbar");
      ground = bar ? Math.round(bar.getBoundingClientRect().top - line()) : h;
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
    /**
     * 빈 곳을 누르면 그 자리에서 눈송이·빗방울이 폭죽처럼 팡 터졌다가 그대로 바닥으로 떨어진다 (제작자 요청 2026-11-02).
     * 바닥에 닿으면 눈은 쌓인 눈에, 비는 고인 빗물에 더해진다
     */
    type Spark = { x: number; y: number; vx: number; vy: number; s: number };
    const sparks: Spark[] = [];
    const flashes: { x: number; y: number; life: number }[] = [];
    /** 누르는 곳: 칸·단추·링크·입력·아래 탭 위는 그 일을 하게 두고 빈 곳만 */
    const BUSY = "a, button, input, textarea, select, label, [role=button], [role=link], .tile, .tabbar, .home-corner, .home-weather, .wx-ask, .topbar, .tut-box";
    const onTap = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || t.closest(BUSY) || e.clientY >= ground) return;
      if (sparks.length > 400) return;
      const n = snow ? 30 : 24;
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + rnd(-0.2, 0.2);
        const sp = rnd(3, 7);
        sparks.push({ x: e.clientX, y: e.clientY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, s: snow ? (Math.random() < 0.3 ? 3 : Math.random() < 0.5 ? 2 : 1) : 1 });
      }
      // 터지는 순간 가운데가 반짝
      flashes.push({ x: e.clientX, y: e.clientY, life: 1 });
    };
    window.addEventListener("pointerdown", onTap);
    /** 마지막으로 만진 때 (잠수인지) */
    let active = performance.now();
    const touch = () => {
      active = performance.now();
    };
    const ACTIVE_EVENTS = ["pointerdown", "keydown", "wheel", "touchmove", "scroll"] as const;
    for (const ev of ACTIVE_EVENTS) window.addEventListener(ev, touch, { passive: true, capture: true });
    /** 이만큼 한 번에 쌓는다 (잠수면 더) */
    const boost = () => BASE * (performance.now() - active > IDLE_MS ? IDLE_BOOST : 1);
    /** 화면 맨 위까지 (도트 칸 수) */
    const topCells = () => Math.max(20, Math.floor(ground / P));
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
    /** 떨어진 물방울 도트 하나가 그 자리에 남는다 */
    const drip = (x: number) => {
      const c = Math.floor(x / P);
      if (c >= 0 && c < cols) water[c] = Math.min(topCells(), water[c] + boost());
    };
    /**
     * 물은 옆으로 흐른다: 옆 칸보다 두 칸 높으면 바로, 한 칸 높으면 가끔 맨 위 도트가 옆으로 (그래서 고인 물이 좌우로 조금씩 번져 나간다).
     * 매번 방향을 바꿔 한쪽으로 쏠리지 않게
     */
    let wsweep = 1;
    const flow = () => {
      wsweep = -wsweep;
      for (let i = 0; i < cols; i++) {
        const c = wsweep > 0 ? i : cols - 1 - i;
        if (!water[c]) continue;
        const l = c > 0 ? water[c - 1] : Infinity;
        const r = c < cols - 1 ? water[c + 1] : Infinity;
        const low = l < r ? c - 1 : l > r ? c + 1 : Math.random() < 0.5 ? c - 1 : c + 1;
        if (low < 0 || low >= cols) continue;
        const diff = water[c] - water[low];
        if (diff >= 2 || (diff === 1 && Math.random() < 0.2)) {
          water[c]--;
          water[low]++;
        }
      }
    };
    /**
     * 물은 수면이 평평하다: 바람 때문에 한쪽에 더 떨어져도, 평균보다 두 칸 넘게 높은 칸의 물을 평균보다 낮은 칸으로 조금씩 옮긴다
     * (옆으로만 흘리면 화면 끝에서 끝까지 펴지는 데 너무 오래 걸려 비스듬했다)
     */
    const level = (arr: number[], high: number, low: number, max = 40) => {
      let total = 0;
      for (let c = 0; c < cols; c++) total += arr[c];
      const mean = total / cols;
      if (mean < 1) return;
      const lo = Math.floor(Math.random() * cols);
      for (let moved = 0, tries = 0; moved < max && tries < cols; tries++) {
        const c = (lo + tries * 7) % cols;
        if (arr[c] < mean + high) continue;
        // 가까운 낮은 칸부터
        for (let d = 1; d < cols * 2; d++) {
          const t = c + (d % 2 ? (d + 1) / 2 : -d / 2);
          if (t < 0 || t >= cols || arr[t] > mean - low) continue;
          arr[c]--;
          arr[t]++;
          moved++;
          break;
        }
      }
    };
    /** 눈송이가 닿으면 그 자리에 그 송이만큼 도트를 바로 얹는다 (한 톨 한 톨 보이게) */
    /**
     * 눈송이가 닿으면 그 송이만큼 도트를 얹는다. 한 칸에 몰아 얹지 않고 닿은 자리 둘레(±3칸)에서 가장 낮은 칸부터 한 톨씩
     * (2026-11-02 제작자: 뾰족뾰족 올라오는 게 보기 싫다. 빨리 쌓을 때(boost) 한 칸에 수십 톨이 쌓여 바늘처럼 솟았다)
     */
    const land = (x: number, size: number) => {
      const c0 = Math.floor(x / P);
      const total = FLAKE_CELLS[size].reduce((t, [, n]) => t + n, 0) * snow!.grow * boost();
      const top = topCells();
      for (let k = 0; k < total; k++) {
        let best = -1;
        for (let dx = -3; dx <= 3; dx++) {
          const c = c0 + dx;
          if (c < 0 || c >= cols || pile[c] >= top) continue;
          if (best < 0 || pile[c] < pile[best] || (pile[c] === pile[best] && Math.abs(dx) < Math.abs(best - c0))) best = c;
        }
        if (best < 0) return;
        pile[best]++;
      }
    };
    /**
     * 눈의 안식각: 쌓인 자리는 그대로 두고, 옆 칸보다 세 칸 넘게 높아 가파른 곳에서만 한 톨씩 낮은 쪽으로 흘러내린다 (두 칸 높으면 가끔).
     * 평평한 곳은 흐르지 않는다 (제작자 2026-11-02: '옆으로 막 흘러서 채워지는 모습이 너무 각지고 부자연스러워. 눈도 어느 정도 쌓여 안식각을 넘어 가파르게 되면
     * 그때 조금씩 흘러내리는 거지, 평평한데도 흘러내리지 않아'. 전에는 차이의 절반을 한 번에 옮기고, 평균보다 높은 곳의 눈을 멀리 낮은 곳으로 옮기는 level 도 해서
     * 평평한 선반과 절벽이 생겼다). 매번 방향을 바꿔 한쪽으로 쏠리지 않게. 빨리 쌓일 때도 따라가게 한 번에 여러 번 훑는다
     */
    let sweep = 1;
    const settle = () => {
      for (let pass = 0; pass < 3; pass++) {
        sweep = -sweep;
        for (let i = 0; i < cols; i++) {
          const c = sweep > 0 ? i : cols - 1 - i;
          const l = c > 0 ? pile[c - 1] : Infinity;
          const r = c < cols - 1 ? pile[c + 1] : Infinity;
          const low = l < r ? c - 1 : l > r ? c + 1 : Math.random() < 0.5 ? c - 1 : c + 1;
          if (low < 0 || low >= cols) continue;
          const diff = pile[c] - pile[low];
          if (diff >= 3 || (diff === 2 && Math.random() < 0.15)) {
            pile[c]--;
            pile[low]++;
          }
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
          const surface = ground - (water[wc] ?? 0) * P;
          if (d.y + d.len >= surface) {
            splash(snap(d.x), surface);
            drip(d.x);
            Object.assign(d, newDrop(true));
            continue;
          }
          const x = snap(d.x);
          const y = snap(d.y);
          const half = snap(d.len / 2);
          ctx.fillRect(x, y, P, half);
          ctx.fillRect(x, y + half, P, half);
        }
        // 고인 빗물: 도트가 칸마다 쌓여 옆으로 흐른다 (높이 찰수록 여러 번 흘려 수면이 평평하게). 맨 위 도트는 밝게, 천천히 반짝인다
        for (let pass = 0; pass < 2; pass++) flow();
        level(water, 2, 1);
        const t = now / 600;
        for (let c = 0; c < cols; c++) {
          const n = water[c];
          if (!n) continue;
          const x = c * P;
          ctx.fillStyle = "rgba(120, 172, 240, 0.75)";
          ctx.fillRect(x, ground - n * P, P, n * P);
          ctx.fillStyle = `rgba(205, 230, 255, ${0.7 + 0.3 * Math.sin(t + c * 0.4)})`;
          ctx.fillRect(x, ground - n * P, P, P);
        }
        // 튀는 물방울: 조금 튀었다가 떨어진다. 떨어진 도트는 (KEEP 만큼) 그 자리에 남아 고인다
        ctx.fillStyle = "rgba(210, 232, 255, 1)";
        for (let i = bits.length - 1; i >= 0; i--) {
          const b = bits[i];
          b.x += b.vx * k;
          b.y += b.vy * k;
          b.vy += 0.3 * k;
          b.life -= 0.02 * k;
          const bc = Math.max(0, Math.min(cols - 1, Math.floor(b.x / P)));
          if (b.vy > 0 && b.y >= ground - (water[bc] ?? 0) * P - P) {
            if (Math.random() < KEEP) drip(b.x);
            bits.splice(i, 1);
            continue;
          }
          if (b.life <= 0 || b.x < -4 || b.x > w + 4) {
            bits.splice(i, 1);
            continue;
          }
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
          f.x += (snow.wind * Math.sin(now / 15000) + Math.sin(f.ph) * 0.5) * k;
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
        // 눈은 안식각을 넘은 가파른 곳만 흘러내린다. 물처럼 평평하게 고르는 level 은 눈에는 쓰지 않는다 (선반과 절벽이 생겨 각졌다, 제작자 2026-11-02)
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
      // 폭죽: 사방으로 터졌다가(공기에 느려지고) 무게로 바닥까지 쭉 떨어진다
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        f.life -= 0.12 * k;
        if (f.life <= 0) {
          flashes.splice(i, 1);
          continue;
        }
        const r = snap((1 - f.life) * 10) + P;
        ctx.globalAlpha = f.life;
        ctx.fillStyle = snow ? "#ffffff" : "rgba(210, 232, 255, 1)";
        ctx.fillRect(snap(f.x) - r, snap(f.y), P, P);
        ctx.fillRect(snap(f.x) + r, snap(f.y), P, P);
        ctx.fillRect(snap(f.x), snap(f.y) - r, P, P);
        ctx.fillRect(snap(f.x), snap(f.y) + r, P, P);
        ctx.fillRect(snap(f.x) - P, snap(f.y) - P, P * 3, P * 3);
      }
      ctx.globalAlpha = 1;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        sp.vx *= Math.pow(0.95, k);
        sp.vy = sp.vy * Math.pow(0.97, k) + 0.22 * k;
        sp.x += sp.vx * k;
        sp.y += sp.vy * k;
        const c = Math.max(0, Math.min(cols - 1, Math.floor(sp.x / P)));
        const floor = ground - (snow ? pile[c] ?? 0 : water[c] ?? 0) * P;
        if (sp.x < -6 || sp.x > w + 6) {
          sparks.splice(i, 1);
          continue;
        }
        if (sp.vy > 0 && sp.y >= floor - P) {
          if (snow) land(sp.x, sp.s);
          else {
            drip(sp.x);
            splash(snap(sp.x), floor);
          }
          sparks.splice(i, 1);
          continue;
        }
        const x = snap(sp.x);
        const y = snap(sp.y);
        if (snow) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
          if (sp.s === 3) {
            ctx.fillRect(x - P, y, P * 3, P);
            ctx.fillRect(x, y - P, P, P * 3);
          } else ctx.fillRect(x, y, P * sp.s, P * sp.s);
        } else {
          // 빗방울: 움직이는 쪽으로 짧은 꼬리
          ctx.fillStyle = "rgba(190, 220, 255, 0.95)";
          ctx.fillRect(x, y, P, P);
          ctx.fillStyle = "rgba(165, 205, 255, 0.5)";
          ctx.fillRect(snap(sp.x - sp.vx), snap(sp.y - sp.vy), P, P);
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
      window.removeEventListener("pointerdown", onTap);
      for (const ev of ACTIVE_EVENTS) window.removeEventListener(ev, touch, { capture: true });
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
