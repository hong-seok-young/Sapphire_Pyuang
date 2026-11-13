/**
 * 우주 배경 (설정 > 배경화면, 제작자 2026-11-12 '별똥별과 혜성이 떨어지는 우주 느낌 배경' -> 도트 초안 다섯 -> '도트 갬성, 2px', '별똥별 크기별 색깔별 30가지 넘게, 중간에 끊기지 마',
 * '둘이 겹치면 부딪혀서 작은 쪽이 폭발', '혜성은 조금씩이라도 움직여야'). pages/SpaceBg.tsx 가 처음 켤 때 이 조각을 따로 받는다.
 *
 * - 작은 해상도(px 배 줄인) 그림판에 그리고 CSS 로 키워 도트로 보인다 (image-rendering: pixelated).
 * - 빛(별·별똥별·혜성·불티)은 매 프레임 한 그림판에 더해 그리고 한 번에 올린다 (Light). 칸 사이 자리는 네 칸에 나눠 그려 부드럽게 움직인다.
 * - 별똥별은 화면 밖에서 들어와 반대편 밖으로 나갈 때까지 날아간다 (중간에 꺼지지 않는다). 색 17 x 크기 5 + 깜박임·반짝 불티·긴 빛 자국·무지개·쪼개짐 (쌍둥이는 제작자 2026-11-13 '평행하게 쌍둥이처럼 날아가는 거 별로'로 뺐다). 빈 곳을 누르면 그 자리로 여럿이 날아와 부딪힌다 (boom(x, y)).
 * - 두 별똥별의 머리가 만나면 작은 쪽이 터진다 (번쩍, 충격파 고리, 파편, 연기). 큰 쪽은 잠깐 타오르고 조금 꺾인다.
 * - 혜성은 늘 움직인다: 머리(핵·코마)에서 알갱이가 계속 나와 곧은 이온 꼬리와 휘어 퍼지는 먼지 꼬리가 된다.
 * - 화면이 다른 앱에 가 있으면 requestAnimationFrame 이 멈춰 같이 쉰다. 움직임 줄이기면 한 장면만 그린다 (still).
 */

export interface SpaceOpts {
  /** 1 은하수 · 2 노을 · 3 성운 · 4 행성 · 5 오로라 */
  scene: number;
  /** 도트 한 칸의 CSS 픽셀 (2 또는 3) */
  px: number;
  still?: boolean;
}
export interface SpaceRun {
  stop(): void;
  /** 별똥별 둘을 부딪히게 보낸다 (설정의 '충돌 보기') */
  /** 별똥별 충돌: 화면 좌표(clientX, clientY)를 주면 그 자리, 없으면 위쪽 가운데 */
  boom(cx?: number, cy?: number): void;
}

type RGB = number[];
type Pal = RGB[];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const pal = (a: string[]): Pal => a.map(hex);
const C: RGB = [0, 0, 0];
/** 색 띠에서 t(0~1)의 색 (공유 배열에 담아 돌려준다: 바로 쓰고 버린다) */
function grad(st: Pal, t: number): RGB {
  const n = st.length - 1;
  t = clamp(t, 0, 1) * n;
  const i = Math.min(n - 1, t | 0), f = t - i, a = st[i], b = st[i + 1];
  C[0] = a[0] + (b[0] - a[0]) * f; C[1] = a[1] + (b[1] - a[1]) * f; C[2] = a[2] + (b[2] - a[2]) * f;
  return C;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bay = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];
const mix = (a: RGB, b: RGB, f: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * f));

/** 별똥별 색 (흰 머리 -> 그 색 -> 짙은 끝) */
const DEEP: RGB = [18, 14, 44];
const mpal = (main: RGB): Pal => [[255, 255, 255], mix(main, [255, 255, 255], 0.55), main, mix(main, DEEP, 0.35), mix(main, DEEP, 0.65), DEEP];
const MCOL: Record<string, string> = {
  흰빛: "#e8eeff", 은빛: "#b9c6e8", 얼음: "#9fd8ff", 하늘: "#6fc3ff", 사파이어: "#4f7dff", 보라: "#9a6cf0", 라벤더: "#c6a8ff", 자홍: "#ff5fd2", 장미: "#ff8fb8",
  빨강: "#ff5a4a", 불꽃: "#ff8a2a", 호박: "#ffb23a", 금빛: "#ffd86a", 연두: "#c8ff5a", 초록: "#5aff8a", 청록: "#3ae0c0", 시안: "#5af0ff",
};
const MPAL: Record<string, Pal> = Object.fromEntries(Object.entries(MCOL).map(([k, v]) => [k, mpal(hex(v))]));
/** 크기 (S=3 기준, 2px 이면 U 배): 작을수록 흔하고 빠르다 */
const SIZES = [
  { w: 30, head: 1, len: [6, 10], sp: [150, 220], rate: 16 },
  { w: 30, head: 1, len: [10, 16], sp: [120, 180], rate: 34 },
  { w: 22, head: 1.5, len: [16, 26], sp: [95, 150], rate: 60 },
  { w: 12, head: 2, len: [26, 40], sp: [75, 120], rate: 100 },
  { w: 6, head: 3, len: [40, 58], sp: [55, 90], rate: 160 },
];

const P = {
  white: pal(["#ffffff", "#e8eeff", "#b9c8ff", "#7d93f0", "#4a5cc4", "#2a2f7a"]),
  fire: pal(["#ffffff", "#fff2b0", "#ffc35c", "#f28a26", "#c0405a", "#4a2460"]),
  gold: pal(["#ffffff", "#fff1c8", "#ffd27a", "#f2a24a", "#c46a5a", "#4a2a5a"]),
  ion: pal(["#effcff", "#a6ecff", "#5ab8ff", "#3a6cf0", "#2a3aa0", "#16194a"]),
  violet: pal(["#ffffff", "#f2dcff", "#c99cff", "#9a6cf0", "#6a4ad0", "#2a1f6a"]),
  green: pal(["#ffffff", "#eaffd6", "#a8ff9c", "#3ad08a", "#2a7a6a", "#123a3a"]),
  ice: pal(["#ffffff", "#d6f2ff", "#8fd0ff", "#5a8cff", "#3a4fc0", "#22266a"]),
  train: pal(["#9fe6d0", "#6fb8c8", "#4a7ab0", "#2a3a7a"]),
  smoke: pal(["#6a6488", "#4a4468", "#2e2a48"]),
};

export function startSpace(host: HTMLElement, o: SpaceOpts): SpaceRun {
  const S = o.px === 3 ? 3 : 2, U = 3 / S, Q = S / 3;
  const W = innerWidth, H = innerHeight, cw = Math.ceil(W / S), ch = Math.ceil(H / S);
  host.innerHTML = "";
  // 바탕 그림(점무늬)은 장면마다 늘 같게: 정해진 씨앗의 해시
  const seed0 = 4217 + o.scene * 977;
  const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7 + seed0 * 0.013) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x: number, y: number) => vnoise(x, y) * 0.55 + vnoise(x * 2.03, y * 2.03) * 0.28 + vnoise(x * 4.1, y * 4.1) * 0.17;

  function layer(w: number, h: number, x: number, y: number, z: number, css = "") {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.style.cssText = `left:${x * S}px;top:${y * S}px;width:${w * S}px;height:${h * S}px;z-index:${z};${css}`;
    host.appendChild(cv);
    return cv;
  }
  function paint(cv: HTMLCanvasElement, fn: (x: number, y: number) => RGB | null | undefined) {
    const g = cv.getContext("2d")!, im = g.createImageData(cv.width, cv.height), d = im.data;
    for (let y = 0; y < cv.height; y++)
      for (let x = 0; x < cv.width; x++) {
        const c = fn(x, y);
        if (!c) continue;
        const k = (y * cv.width + x) * 4;
        d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = c.length > 3 ? c[3] : 255;
      }
    g.putImageData(im, 0, 0);
  }
  const fine = (st: Pal, k = 3): Pal => {
    const out: Pal = [];
    for (let i = 0; i < st.length - 1; i++) for (let j = 0; j < k; j++) out.push(mix(st[i], st[i + 1], j / k));
    out.push(st[st.length - 1]);
    return out;
  };
  /** 옛날 게임처럼 점무늬로 넘어가는 그라데이션 */
  const ditherGrad = (st0: Pal) => {
    const st = fine(st0);
    return (x: number, y: number) => { const n = st.length - 1, p = (y / (ch - 1)) * n, i = Math.min(n - 1, p | 0), f = p - i; return f > bay(x, y) ? st[i + 1] : st[i]; };
  };

  // ---------- 빛 그림판 ----------
  const lc = layer(cw, ch, 0, 0, 2), lg = lc.getContext("2d")!, img = lg.createImageData(cw, ch), out = img.data;
  const acc = new Float32Array(cw * ch * 4), mark = new Uint8Array(cw * ch), list = new Int32Array(cw * ch);
  let ln = 0;
  function add(x: number, y: number, c: RGB, a: number) {
    if (a < 0.006 || x < 0 || y < 0 || x >= cw || y >= ch) return;
    const p = y * cw + x;
    if (!mark[p]) { mark[p] = 1; list[ln++] = p; }
    const k = p * 4;
    acc[k] += c[0] * a; acc[k + 1] += c[1] * a; acc[k + 2] += c[2] * a; acc[k + 3] += a;
  }
  function splat(x: number, y: number, c: RGB, a: number) {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    add(x0, y0, c, a * (1 - fx) * (1 - fy)); add(x0 + 1, y0, c, a * fx * (1 - fy));
    add(x0, y0 + 1, c, a * (1 - fx) * fy); add(x0 + 1, y0 + 1, c, a * fx * fy);
  }
  function flush() {
    for (let i = 0; i < ln; i++) {
      const k = list[i] * 4, a = acc[k + 3];
      let r = acc[k] / a, g = acc[k + 1] / a, b = acc[k + 2] / a;
      if (a > 1) { const w = Math.min(1, (a - 1) * 0.45); r += (255 - r) * w; g += (255 - g) * w; b += (255 - b) * w; }
      out[k] = r; out[k + 1] = g; out[k + 2] = b; out[k + 3] = Math.min(1, a) * 255;
    }
    lg.putImageData(img, 0, 0);
    for (let i = 0; i < ln; i++) { const p = list[i], k = p * 4; acc[k] = acc[k + 1] = acc[k + 2] = acc[k + 3] = 0; out[k] = out[k + 1] = out[k + 2] = out[k + 3] = 0; mark[p] = 0; }
    ln = 0;
  }

  // ---------- 별 ----------
  interface Star { x: number; y: number; c: RGB; b: number; amp: number; sp: number; ph: number; big: boolean }
  function makeStars(dens: number, cols: string[], maxY = 1, big = 0.06): Star[] {
    const n = Math.round(cw * ch * dens * Q * Q), outS: Star[] = [];
    for (let i = 0; i < n; i++) {
      const isBig = Math.random() < big;
      outS.push({ x: Math.floor(rnd(0, cw)), y: Math.floor(rnd(0, ch * maxY)), c: hex(pick(cols)), b: isBig ? rnd(0.75, 1) : rnd(0.25, 0.8), amp: isBig ? rnd(0.35, 0.6) : rnd(0.25, 0.7), sp: rnd(0.6, 2.2), ph: rnd(0, 6.28), big: isBig });
    }
    return outS;
  }
  function drawStars(stars: Star[], t: number, fade?: (x: number, y: number) => number) {
    for (const s of stars) {
      let i = s.b * (1 - s.amp + s.amp * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph)));
      if (fade) i *= fade(s.x, s.y);
      add(s.x, s.y, s.c, i);
      if (s.big) {
        const g = Math.max(0, Math.sin(t * s.sp * 0.6 + s.ph * 1.7)), arm = i * (0.25 + 0.55 * g * g), a2 = arm * g * 0.55;
        add(s.x + 1, s.y, s.c, arm); add(s.x - 1, s.y, s.c, arm); add(s.x, s.y + 1, s.c, arm); add(s.x, s.y - 1, s.c, arm);
        add(s.x + 2, s.y, s.c, a2); add(s.x - 2, s.y, s.c, a2); add(s.x, s.y + 2, s.c, a2); add(s.x, s.y - 2, s.c, a2);
      }
    }
  }

  // ---------- 불티 ----------
  interface Part { x: number; y: number; vx: number; vy: number; ax: number; ay: number; drag: number; age: number; life: number; st: Pal; a: number; fr: number; ph: number; sh: number; soft: boolean }
  interface EmitOpt { ax?: number; ay?: number; drag?: number; sh?: number; soft?: boolean }
  let parts: Part[] = [];
  function emit(x: number, y: number, vx: number, vy: number, life: number, st: Pal, a: number, e: EmitOpt = {}) {
    if (parts.length > 9000) return;
    parts.push({ x, y, vx, vy, ax: e.ax ?? 0, ay: e.ay ?? 0, drag: e.drag ?? 0.9, age: 0, life, st, a, fr: rnd(5, 14), ph: rnd(0, 6.28), sh: e.sh ?? 0, soft: !!e.soft });
  }
  function stepParts(dt: number) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      const k = Math.pow(p.drag, dt);
      p.vx = p.vx * k + p.ax * dt; p.vy = p.vy * k + p.ay * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }
  function drawParts() {
    for (const p of parts) {
      const u = p.age / p.life;
      let a = p.a * Math.pow(1 - u, 1.35) * (0.72 + 0.28 * Math.sin(p.age * p.fr + p.ph));
      if (p.sh) a *= 0.4 + Math.max(0, Math.sin(p.age * p.sh + p.ph)) ** 2 * 0.96;
      if (p.soft) splat(p.x, p.y, grad(p.st, u), a * 1.25);
      else add(Math.round(p.x), Math.round(p.y), grad(p.st, u), a);
    }
  }

  // ---------- 번쩍임·충격파 고리 ----------
  interface Fx { ring: boolean; x: number; y: number; age: number; life: number; r: number; c: RGB; delay: number }
  let fxs: Fx[] = [];
  function stepFx(dt: number) {
    for (let i = fxs.length - 1; i >= 0; i--) { const f = fxs[i]; f.age += dt; if (f.age > f.life + f.delay) fxs.splice(i, 1); }
  }
  function drawFx() {
    for (const f of fxs) {
      const t = f.age - f.delay;
      if (t < 0) continue;
      const u = t / f.life;
      if (!f.ring) {
        const r = f.r * (0.55 + 0.45 * u), a = (1 - u) ** 2 * 1.6;
        for (let y = Math.floor(f.y - r); y <= f.y + r; y++)
          for (let x = Math.floor(f.x - r); x <= f.x + r; x++) {
            const d = Math.hypot(x + 0.5 - f.x, y + 0.5 - f.y) / r;
            if (d < 1) add(x, y, f.c, a * (1 - d * d));
          }
      } else {
        const r = f.r * (1 - (1 - u) ** 3), n = Math.max(8, Math.ceil(r * 7)), a = (1 - u) ** 1.6 * 0.85;
        for (let k = 0; k < n; k++) { const th = (k / n) * 6.2832; splat(f.x + Math.cos(th) * r, f.y + Math.sin(th) * r, f.c, a); }
      }
    }
  }

  // ---------- 별똥별 ----------
  interface Met {
    x: number; y: number; px: number; py: number; ux: number; uy: number; sp: number; age: number; life: number; len: number; head: number; size: number;
    st: Pal; rate: number; acc: number; train: number; trainLong: boolean; flick: number; spark: boolean; rainbow: number; flare: number; group: number; split: number;
  }
  let meteors: Met[] = [];
  let groupN = 0;
  /** 상자 안의 점 p 에서 방향 d 로 화면 끝까지 거리 */
  const exitDist = (x: number, y: number, dx: number, dy: number) => {
    let t = 1e9;
    if (dx > 1e-6) t = Math.min(t, (cw - x) / dx); else if (dx < -1e-6) t = Math.min(t, -x / dx);
    if (dy > 1e-6) t = Math.min(t, (ch - y) / dy); else if (dy < -1e-6) t = Math.min(t, -y / dy);
    return Math.max(0, t);
  };
  const inView = (x: number, y: number) => x >= 0 && y >= 0 && x < cw && y < ch;
  let bias: string[] = [];
  function meteorType() {
    const tot = SIZES.reduce((s, z) => s + z.w, 0);
    let r = Math.random() * tot, size = 0;
    for (; size < SIZES.length - 1; size++) { r -= SIZES[size].w; if (r < 0) break; }
    const names = Object.keys(MCOL), col = Math.random() < 0.45 && bias.length ? pick(bias) : pick(names);
    return { size, col };
  }
  /** 화면 안의 한 점(tx, ty)을 지나가게, 화면 밖에서 시작해 반대편 밖으로 나갈 때까지 */
  function launch(tx: number, ty: number, ang: number, from?: { x: number; y: number }, kind?: { size: number; col: string; sp?: number }, extra?: Partial<Met>) {
    const k = kind ?? meteorType(), z = SIZES[k.size], a = (ang * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
    const len = rnd(z.len[0], z.len[1]) * U * (k.size >= 3 ? 1 : rnd(0.85, 1.15)), sp: number = (kind && kind.sp) || rnd(z.sp[0], z.sp[1]) * U;
    const back = from ? Math.hypot(tx - from.x, ty - from.y) : exitDist(tx, ty, -ux, -uy) + len + 4;
    const sx = from ? from.x : tx - ux * back, sy = from ? from.y : ty - uy * back;
    const life = (back + exitDist(tx, ty, ux, uy) + len + 6) / sp;
    const m: Met = {
      x: sx, y: sy, px: sx, py: sy, ux, uy, sp, age: 0, life, len, head: z.head, size: k.size, st: MPAL[k.col], rate: z.rate, acc: 0,
      train: 0.2, trainLong: false, flick: 0, spark: false, rainbow: -1, flare: 0, group: ++groupN, split: -1,
    };
    if (Math.random() < 0.25) m.flick = rnd(7, 16);
    if (Math.random() < 0.18) m.spark = true;
    if (Math.random() < 0.2) { m.train = 0.6; m.trainLong = true; }
    if (Math.random() < 0.035) m.rainbow = rnd(0, 360);
    if (k.size >= 3 && Math.random() < (k.size === 4 ? 0.45 : 0.15)) m.split = (back + rnd(0.15, 0.55) * exitDist(tx, ty, ux, uy)) / sp;
    Object.assign(m, extra);
    meteors.push(m);
    return m;
  }
  /** 보통 별똥별: 대개 왼쪽 아래로, 넷에 하나는 오른쪽 아래로 */
  const sporadic = () => launch(rnd(0.08, 0.92) * cw, rnd(0.05, 0.7) * ch, Math.random() < 0.75 ? rnd(110, 160) : rnd(20, 70));
  function rainbowPal(m: Met) {
    const h = (m.rainbow + m.age * 160) % 360, f = (n: number) => { const k = (n + h / 30) % 12; return 255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
    m.st = mpal([f(0), f(8), f(4)].map((v) => Math.round(v * 0.6 + 102)));
  }
  function explode(m: Met) {
    const x = m.x, y = m.y, big = m.head;
    fxs.push({ ring: false, x, y, age: 0, life: 0.26, r: (4 + big * 2) * U, c: [255, 250, 235], delay: 0 });
    fxs.push({ ring: true, x, y, age: 0, life: 0.55, r: (10 + big * 6) * U, c: m.st[1], delay: 0 });
    fxs.push({ ring: true, x, y, age: 0, life: 0.8, r: (16 + big * 8) * U, c: m.st[2], delay: 0.07 });
    const n = 40 + big * 30;
    for (let k = 0; k < n; k++) {
      const a = rnd(0, 6.2832), s = rnd(15, 65) * U * (0.6 + big * 0.3), sh = Math.random() < 0.3;
      emit(x, y, Math.cos(a) * s + m.ux * m.sp * 0.25, Math.sin(a) * s + m.uy * m.sp * 0.25, rnd(0.5, 1.4), m.st, rnd(0.8, 1.25), { drag: 0.3, ay: 7 * U, sh: sh ? rnd(8, 14) : 0, soft: !sh && Math.random() < 0.5 });
    }
    for (let k = 0; k < 10; k++) { const a = rnd(0, 6.2832), s = rnd(4, 14) * U; emit(x, y, Math.cos(a) * s, Math.sin(a) * s, rnd(0.3, 0.6), P.fire, 1, { drag: 0.2 }); }
    for (let k = 0; k < 8; k++) { const a = rnd(0, 6.2832), s = rnd(2, 6) * U; emit(x, y, Math.cos(a) * s, Math.sin(a) * s - 2 * U, rnd(1.2, 2.2), P.smoke, 0.22, { drag: 0.6, soft: true }); }
  }
  function splitMeteor(m: Met) {
    fxs.push({ ring: false, x: m.x, y: m.y, age: 0, life: 0.18, r: 4 * U, c: [255, 245, 220], delay: 0 });
    const parts2 = m.size === 4 ? 3 : 2, ang = Math.atan2(m.uy, m.ux) * (180 / Math.PI);
    for (let k = 0; k < parts2; k++) {
      const d = (k - (parts2 - 1) / 2) * rnd(5, 9), a = ((ang + d) * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), sp = m.sp * rnd(0.9, 1.05);
      const size = Math.max(0, m.size - 2 + (k === 0 ? 1 : 0)), z = SIZES[size];
      meteors.push({ ...m, ux, uy, sp, size, head: z.head, len: rnd(z.len[0], z.len[1]) * U, rate: z.rate, age: 0, life: (exitDist(m.x, m.y, ux, uy) + 40 * U) / sp, split: -1, px: m.x, py: m.y });
    }
  }
  const menv = (m: Met) => (1 + (m.flick ? 0.35 * Math.sin(m.age * m.flick) * Math.sin(m.age * m.flick * 0.37 + 1) : 0)) * (1 + 1.2 * m.flare);
  function stepMeteors(dt: number) {
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.age += dt;
      if (m.age >= m.life) { meteors.splice(i, 1); continue; }
      if (m.rainbow >= 0) rainbowPal(m);
      m.flare = Math.max(0, m.flare - dt * 2.2);
      m.px = m.x; m.py = m.y;
      m.x += m.ux * m.sp * dt; m.y += m.uy * m.sp * dt;
      if (m.split > 0 && m.age >= m.split) { meteors.splice(i, 1); splitMeteor(m); continue; }
      m.acc += m.rate * dt;
      const e = menv(m);
      while (m.acc >= 1) {
        m.acc--;
        const back = rnd(0, 3) * U, j = rnd(-0.6, 0.6) * U * (0.6 + m.head * 0.4), sh = m.spark && Math.random() < 0.3;
        emit(m.x - m.ux * back - m.uy * j, m.y - m.uy * back + m.ux * j, m.ux * m.sp * rnd(0.02, 0.12) + rnd(-4, 4) * U, m.uy * m.sp * rnd(0.02, 0.12) + rnd(-4, 4) * U,
          rnd(0.25, 0.65) * (sh ? 1.6 : 1), m.st, rnd(0.45, 0.95) * Math.min(1.4, e) * (sh ? 1.3 : 1), { drag: 0.25, ay: rnd(1, 4) * U, sh: sh ? rnd(9, 15) : 0 });
        if (Math.random() < m.train)
          emit(m.x - m.ux * rnd(2, 8) * U, m.y - m.uy * rnd(2, 8) * U, rnd(-1.2, 1.2) * U, rnd(-0.8, 0.4) * U, m.trainLong ? rnd(1.6, 2.8) : rnd(0.9, 1.6), m.trainLong ? m.st.slice(1) : P.train, rnd(0.12, 0.25), { drag: 0.8 });
      }
    }
    // 부딪힘: 이번 프레임에 두 머리가 지나간 길이 가까우면 작은 쪽이 터진다 (같이 떨어지는 쌍둥이·조각은 빼고)
    for (let i = 0; i < meteors.length; i++)
      for (let j = i + 1; j < meteors.length; j++) {
        const a = meteors[i], b = meteors[j];
        if (a.group === b.group || !inView(a.x, a.y) || !inView(b.x, b.y)) continue;
        const d0x = a.px - b.px, d0y = a.py - b.py, vx = a.x - b.x - d0x, vy = a.y - b.y - d0y, vv = vx * vx + vy * vy;
        const t = vv > 0 ? clamp(-(d0x * vx + d0y * vy) / vv, 0, 1) : 0, dist = Math.hypot(d0x + vx * t, d0y + vy * t);
        if (dist > (1.2 + 0.5 * (a.head + b.head)) * U) continue;
        const small = a.size < b.size || (a.size === b.size && a.len < b.len) ? a : b, big = small === a ? b : a;
        meteors.splice(meteors.indexOf(small), 1);
        explode(small);
        big.flare = 0.5;
        const ang = Math.atan2(big.uy, big.ux) + (rnd(-7, 7) * Math.PI) / 180;
        big.ux = Math.cos(ang); big.uy = Math.sin(ang); big.sp *= 0.92;
        big.life = big.age + (exitDist(clamp(big.x, 0, cw), clamp(big.y, 0, ch), big.ux, big.uy) + big.len + 6) / big.sp;
        return;
      }
  }
  function drawMeteors(t: number) {
    for (const m of meteors) {
      const e = menv(m), len = m.len * Math.min(1, m.age / 0.18), thick = m.head >= 2 ? (m.head >= 3 ? 2 : 1) : 0;
      for (let s = 0; s < len; s += 0.5) {
        const f = s / len, a = e * Math.pow(1 - f, 1.7) * 0.95, x = m.x - m.ux * s, y = m.y - m.uy * s;
        splat(x, y, grad(m.st, f * 0.9), a);
        for (let w = 1; w <= thick; w++) { const aw = a * (w === 1 ? 0.45 : 0.2) * (1 - f); splat(x - m.uy * w * 0.8, y + m.ux * w * 0.8, grad(m.st, f + 0.15), aw); splat(x + m.uy * w * 0.8, y - m.ux * w * 0.8, grad(m.st, f + 0.15), aw); }
      }
      const hx = Math.round(m.x), hy = Math.round(m.y), g = 0.45 + 0.3 * Math.sin(t * 40 + m.x), r = m.head >= 2 ? 2 : 1;
      splat(m.x, m.y, P.white[0], Math.min(2.2, e * 1.4 * m.head));
      if (m.head >= 2) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) add(hx + dx, hy + dy, m.st[1], e * 0.7);
      if (m.head >= 3) for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) add(hx + dx, hy + dy, m.st[2], e * 0.45);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) add(hx + dx * r, hy + dy * r, m.st[1], e * g * 0.55);
    }
  }

  // ---------- 혜성 (늘 움직인다) ----------
  interface Comet {
    x: number; y: number; vx: number; vy: number; tx: number; ty: number; age: number; life: number; R: number; ion: Pal; dust: Pal; coma: RGB;
    ionRate: number; dustRate: number; ionLen: number[]; dustLen: number[]; ionLife: number[]; dustLife: number[]; curve: number; ai: number; ad: number; fadeIn: number;
  }
  interface CometOpt { x: number; y: number; ang: number; speed: number; life: number; tailAng: number; R?: number; ion: Pal; dust: Pal; coma: string; ionRate?: number; dustRate?: number;
    ionLen?: number[]; dustLen?: number[]; ionLife?: number[]; dustLife?: number[]; curve?: number; fadeIn?: number }
  let comets: Comet[] = [];
  function comet(c: CometOpt) {
    const a = (c.ang * Math.PI) / 180, ta = (c.tailAng * Math.PI) / 180;
    comets.push({
      x: c.x, y: c.y, vx: Math.cos(a) * c.speed, vy: Math.sin(a) * c.speed, tx: Math.cos(ta), ty: Math.sin(ta), age: 0, life: c.life, R: (c.R ?? 8) * U, ion: c.ion, dust: c.dust, coma: hex(c.coma),
      ionRate: c.ionRate ?? 180, dustRate: c.dustRate ?? 240, ionLen: (c.ionLen ?? [24, 40]).map((v) => v * U), dustLen: (c.dustLen ?? [6, 14]).map((v) => v * U),
      ionLife: c.ionLife ?? [1.3, 2.1], dustLife: c.dustLife ?? [2.2, 3.6], curve: (c.curve ?? 2.4) * U, ai: 0, ad: 0, fadeIn: c.fadeIn ?? 1,
    });
  }
  const cEnv = (c: Comet) => Math.min(1, c.age / c.fadeIn) * Math.min(1, (c.life - c.age) / 1.5);
  function stepComets(dt: number) {
    for (let i = comets.length - 1; i >= 0; i--) {
      const c = comets[i];
      c.age += dt;
      if (c.age > c.life) { comets.splice(i, 1); continue; }
      c.x += c.vx * dt; c.y += c.vy * dt;
      const e = cEnv(c), px = -c.ty, py = c.tx;
      c.ai += c.ionRate * dt; c.ad += c.dustRate * dt;
      while (c.ai >= 1) {
        c.ai--;
        const s = rnd(c.ionLen[0], c.ionLen[1]), j = rnd(-0.8, 0.8) * U, w = rnd(-0.9, 0.9) * U;
        emit(c.x + px * j, c.y + py * j, c.tx * s + px * w, c.ty * s + py * w, rnd(c.ionLife[0], c.ionLife[1]), c.ion, rnd(0.35, 0.7) * e, { drag: 1 });
      }
      while (c.ad >= 1) {
        c.ad--;
        const s = rnd(c.dustLen[0], c.dustLen[1]), j = rnd(-1.6, 1.6) * U, w = rnd(-3.8, 3.8) * U, sp = Math.random() < 0.06;
        emit(c.x + px * j, c.y + py * j, c.tx * s + px * w, c.ty * s + py * w, rnd(c.dustLife[0], c.dustLife[1]), c.dust, (sp ? 1 : rnd(0.35, 0.7)) * e,
          { drag: 0.82, ax: c.tx * 2 * U + px * c.curve, ay: c.ty * 2 * U + py * c.curve, sh: sp ? rnd(6, 11) : 0, soft: !sp });
      }
    }
  }
  function drawComets(t: number) {
    for (const c of comets) {
      const e = cEnv(c);
      if (e <= 0) continue;
      const R = c.R * (1 + 0.06 * Math.sin(t * 2.3));
      for (let y = Math.floor(c.y - R); y <= c.y + R; y++)
        for (let x = Math.floor(c.x - R); x <= c.x + R; x++) {
          const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) / R;
          if (d < 1) add(x, y, c.coma, e * Math.pow(1 - d, 2) * 0.75);
        }
      splat(c.x - 0.5, c.y - 0.5, P.white[0], e * 1.5);
      const g = 0.5 + 0.5 * Math.sin(t * 3.1), hx = Math.round(c.x - 0.5), hy = Math.round(c.y - 0.5), r = Math.round(2 * U);
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) add(hx + dx, hy + dy, P.white[1], e * (0.25 + 0.35 * g));
    }
  }
  /** 화면을 비스듬히 가로지르는 혜성 (꼬리는 뒤쪽 조금 위로) */
  function crossComet(c: Omit<CometOpt, "x" | "y" | "ang" | "speed" | "life" | "tailAng"> & { speed: number[] }) {
    const ltr = Math.random() < 0.5, a = rnd(10, 22), sp = rnd(c.speed[0], c.speed[1]) * U, ang = ltr ? a : 180 - a;
    comet({ ...c, x: ltr ? -10 * U : cw + 10 * U, y: rnd(0.06, 0.28) * ch, ang, speed: sp, life: (cw + 40 * U) / (sp * Math.cos((a * Math.PI) / 180)) + 1.5, tailAng: ang + 180 + (ltr ? 14 : -14) });
  }

  // ---------- 장면 ----------
  interface Scene { draw(t: number): void; every: [() => void, number, number][]; comet?: [() => void, number, number]; post?(t: number): void }

  function s1(): Scene {
    const bg = pal(["#06081a", "#0a0d28", "#0e1134", "#131640", "#191a4b", "#1f1d55", "#251f5c"]);
    const band = pal(["#1e2258", "#262d6c", "#323b84", "#43499a", "#5f64b2", "#878bcc"]);
    const core = pal(["#242254", "#332c68", "#4d3e78", "#6e557c", "#94707e", "#bc928e"]);
    const cx = cw * 0.5, cy = ch * 0.42, an = (-32 * Math.PI) / 180, ca = Math.cos(an), sa = Math.sin(an), base = ditherGrad(bg);
    const lights = ["#ffffff", "#dfe6ff", "#ffe8c8"].map(hex), dim = hex("#3e52a8");
    paint(layer(cw, ch, 0, 0, 1), (x, y) => {
      const dx = x - cx, dy = y - cy, along = dx * ca + dy * sa, across = -dx * sa + dy * ca, w = ch * 0.075 + ch * 0.02 * Math.sin(along * 0.03 * Q);
      let dens = Math.exp(-((across / w) ** 2)) * (0.55 + 0.45 * fbm(along * 0.06 * Q + 10, across * 0.09 * Q));
      dens *= 1 - 0.6 * Math.exp(-(((across - 2 * U) / (w * 0.16)) ** 2)) * (0.4 + 0.6 * fbm(along * 0.1 * Q, 3));
      const lv = dens * 4.6 + bay(x, y) - 0.8;
      if (lv < 0) return hash(x * 3, y * 7) < 0.006 * Q * Q ? dim : base(x, y);
      if (hash(x, y) < dens * 0.05 * Q * Q) return lights[Math.floor(hash(y, x) * 3)];
      const c = Math.abs(along) < cw * 0.3 && bay(y, x) < 1 - Math.abs(along) / (cw * 0.3) ? core : band;
      return c[Math.min(5, lv | 0)];
    });
    bias = ["흰빛", "은빛", "얼음", "금빛", "라벤더"];
    const stars = makeStars(0.011, ["#ffffff", "#c6d5ff", "#9fb2ff", "#ffe7b0", "#ffd0a0"]);
    return { draw: (t) => drawStars(stars, t), every: [[sporadic, 1.2, 3.2]], comet: [() => crossComet({ speed: [15, 20], ion: P.ion, dust: P.gold, coma: "#ffe7b8" }), 13, 19] };
  }

  function s2(): Scene {
    paint(layer(cw, ch, 0, 0, 1), ditherGrad(pal(["#04061a", "#070a24", "#0b0f30", "#12143e", "#1c174c", "#2c1b58", "#43205e", "#62285e", "#8a3554", "#b4473f", "#d86233", "#ef8a2e", "#f6a83c"])));
    const glow = layer(cw, Math.ceil(ch * 0.45), 0, Math.floor(ch * 0.55), 1, "animation:sp-breathe 9s ease-in-out infinite alternate");
    paint(glow, (x, y) => { const gx = (x - cw * 0.5) / (cw * 0.75), gy = (y - ch * 0.32) / (ch * 0.2), a = Math.max(0, 1 - gx * gx - gy * gy); return a * 1.2 > bay(x, y) * 1.4 ? [255, 176, 96, Math.round(70 * a + 20)] : null; });
    const fg = layer(cw, ch, 0, 0, 3);
    const far = (x: number) => ch * 0.8 - fbm(x * 0.035 * Q, 1.5) * ch * 0.12, near = (x: number) => ch * 0.875 - fbm(x * 0.05 * Q + 9, 4) * ch * 0.07;
    // 산 위의 성(네모난 실루엣)은 뺐다 (제작자 2026-11-13 '노을에서 산에 이상한 네모난 물체 실루엣 없애자')
    const C1 = hex("#0b0716"), C2 = hex("#2a1430"), C3 = hex("#140c24"), C5 = hex("#7a3550"), C6 = hex("#4a2550"), C7 = hex("#2a1840");
    paint(fg, (x, y) => {
      const yf = far(x), yn = near(x);
      if (y >= ch * 0.95) return C1;
      if (y >= yn) return y < yn + 1 ? C2 : C3;
      if (y >= yf) return y < yf + 1 ? C5 : y < yf + 3 && bay(x, y) < 0.4 ? C6 : C7;
      return null;
    });
    bias = ["금빛", "호박", "불꽃", "장미", "흰빛", "자홍"];
    const stars = makeStars(0.009, ["#ffffff", "#d4dcff", "#aab8ff", "#ffe2b0"], 0.78);
    const fade = (_x: number, y: number) => clamp((ch * 0.72 - y) / (ch * 0.25), 0, 1);
    // 큰 혜성: 지평선 위를 아주 천천히 가로지른다 (꼬리는 늘 위로)
    const bigComet = (first = false) => {
      const ltr = Math.random() < 0.5, sp = rnd(3.5, 5) * U, ang = ltr ? rnd(2, 7) : 180 - rnd(2, 7), x = first ? cw * rnd(0.22, 0.4) : ltr ? -14 * U : cw + 14 * U;
      const run = ltr ? cw + 14 * U - x : x + 14 * U;
      comet({ x, y: ch * rnd(0.5, 0.6), ang, speed: sp, life: run / sp + 1.5, tailAng: ltr ? -118 : -62, R: 10, ion: P.ion, dust: P.gold, coma: "#ffe8c0",
        ionRate: 200, dustRate: 300, ionLen: [34, 54], dustLen: [9, 20], ionLife: [2.2, 3.2], dustLife: [3.2, 4.6], curve: 3.2, fadeIn: first ? 0.01 : 2 });
    };
    bigComet(true);
    let next = -1;
    const rx = cw * 0.9, ry = -ch * 0.06;
    const shower = () => { const tx2 = rnd(0.05, 0.85) * cw, ty2 = rnd(0.05, 0.6) * ch; launch(tx2, ty2, (Math.atan2(ty2 - ry, tx2 - rx) * 180) / Math.PI, { x: rx, y: ry }); };
    return {
      draw: (t) => drawStars(stars, t, fade),
      every: [[shower, 0.35, 1.2], [sporadic, 1.5, 4]],
      post: (t) => { if (!comets.length) { if (next < 0) next = t + rnd(4, 9); else if (t > next) { next = -1; bigComet(); } } },
    };
  }

  function s3(): Scene {
    paint(layer(cw, ch, 0, 0, 1), ditherGrad(pal(["#04071a", "#070a24", "#0a0e30", "#0e103a", "#120f44", "#170f4b"])));
    const pad = Math.round(14 * U);
    const nebula = (cols: string[], ox: number, oy: number, sc: number, css: string) => {
      const st = pal(cols), cv = layer(cw + pad * 2, ch + pad * 2, -pad, -pad, 1, css);
      paint(cv, (x, y) => {
        const n = fbm(x * sc * Q + ox, y * sc * Q + oy), m = fbm(x * sc * Q * 0.5 + ox + 40, y * sc * Q * 0.5 + oy), d = clamp((n * 0.75 + m * 0.5 - 0.62) * 2.6, 0, 1);
        if (d <= 0) return null;
        const lv = Math.floor(d * 4 + bay(x, y) - 0.3);
        if (lv <= 0) return null;
        const c = grad(st, clamp(m * 1.3 - 0.2 + d * 0.3, 0, 1)), hi = lv >= 4 ? 0.35 : 0;
        return [c[0] + (255 - c[0]) * hi, c[1] + (255 - c[1]) * hi, c[2] + (255 - c[2]) * hi, [0, 70, 110, 150, 185][Math.min(4, lv)]];
      });
    };
    nebula(["#1e3fb0", "#2f6bff", "#5a4ae8", "#8a3ffc", "#c06cff"], 3, 7, 0.03, "--dx:-12px;--dy:8px;animation:sp-drift 46s ease-in-out infinite alternate, sp-breathe 11s ease-in-out infinite alternate");
    nebula(["#3a1a7a", "#8a2fb0", "#e0479e", "#1fb5c9", "#9fe6ff"], 21, 2, 0.024, "--dx:10px;--dy:-9px;animation:sp-drift 58s ease-in-out infinite alternate, sp-breathe 14s ease-in-out -5s infinite alternate");
    bias = ["얼음", "하늘", "사파이어", "보라", "시안", "라벤더"];
    const stars = makeStars(0.01, ["#ffffff", "#cfe0ff", "#9fb8ff", "#e6d6ff", "#ffc6ec"]);
    const flares: [number, number, number][] = [[cw * 0.72, ch * 0.14, 1], [cw * 0.18, ch * 0.5, 0.6]];
    const lens = hex("#bcd8ff"), lens2 = hex("#ffd2f4");
    const mote = () => emit(rnd(0, cw), rnd(ch * 0.5, ch), rnd(-1, 1) * U, -rnd(2.5, 6) * U, rnd(6, 10), P.ice, rnd(0.35, 0.7), { drag: 1, sh: rnd(1.5, 3) });
    return {
      every: [[sporadic, 1.4, 3.6], [mote, 0.25, 0.6]],
      comet: [() => crossComet({ speed: [15, 20], ion: P.ion, dust: P.violet, coma: "#c8e6ff", curve: 3 }), 13, 19],
      draw: (t) => {
        drawStars(stars, t);
        for (const [fx, fy, s] of flares) {
          const x = Math.round(fx), y = Math.round(fy), p = 0.75 + 0.25 * Math.sin(t * 0.9 + fx), len = Math.round(9 * s * U);
          add(x, y, lens, 1.6 * p);
          for (let k = 1; k <= len; k++) { const a = p * Math.pow(1 - k / (len + 1), 1.6) * 0.9; add(x + k, y, lens, a); add(x - k, y, lens, a); add(x, y + k, lens, a); add(x, y - k, lens, a); }
          for (let k = 1; k <= len * 0.45; k++) { const a = p * (1 - k / (len * 0.45 + 1)) * 0.45; add(x + k, y + k, lens2, a); add(x - k, y - k, lens2, a); add(x + k, y - k, lens2, a); add(x - k, y + k, lens2, a); }
        }
      },
    };
  }

  function s4(): Scene {
    const bg = ditherGrad(pal(["#03051a", "#060a24", "#090e2e", "#0d1238", "#121444", "#16154a"])), pole = hex("#1a2264");
    const pxp = cw * 0.86, pyp = ch * 0.1;
    paint(layer(cw, ch, 0, 0, 1), (x, y) => { const d = Math.hypot(x - pxp, y - pyp) / (ch * 0.45); return d < 1 && (1 - d) * 0.9 > bay(x, y) + 0.45 ? pole : bg(x, y); });
    // 하늘은 북극성을 중심으로 천천히 돈다
    const Rmax = Math.hypot(Math.max(pxp, cw - pxp), Math.max(pyp, ch - pyp)) + 4, n = Math.round(Rmax * Rmax * Math.PI * 0.009 * Q * Q);
    const sky: { r: number; a: number; c: RGB; b: number; amp: number; sp: number; ph: number }[] = [];
    for (let i = 0; i < n; i++) sky.push({ r: Math.sqrt(Math.random()) * Rmax, a: rnd(0, 6.28), c: hex(pick(["#ffffff", "#cdd8ff", "#9fb2ff", "#ffe2b0"])), b: rnd(0.25, 0.9), amp: rnd(0.2, 0.6), sp: rnd(0.6, 2), ph: rnd(0, 6.28) });
    const north = hex("#e8f0ff");
    // 행성 (자전, 점무늬 그림자) + 고리 + 앞뒤로 도는 달
    const R = Math.round(Math.min(cw, ch * 0.55) * 0.32), A = R * 2.05, B = A * 0.27, cx = cw * 0.14, cy = ch * 0.79;
    const bx = Math.floor(cx - A - 4), by = Math.floor(cy - R - 4), bw = Math.ceil(A * 2 + 8), bh = Math.ceil(R * 2 + 8);
    const pc = layer(bw, bh, bx, by, 3), pg = pc.getContext("2d")!, pim = pg.createImageData(bw, bh), pd = pim.data;
    const phi = (-16 * Math.PI) / 180, cph = Math.cos(phi), sph = Math.sin(phi), Lx = 0.62, Ly = -0.5, Lz = 0.6, Ln = Math.hypot(Lx, Ly, Lz);
    const bands = pal(["#3b4bb0", "#5468d2", "#6f66d8", "#9a88e6", "#5d73dc", "#d6a088", "#4b5cc6", "#7e8ff0", "#5a4ac0"]);
    const spot = hex("#f2c4a4"), spotRim = hex("#b8706a"), atm = hex("#8fa6ff"), ringIn = hex("#6b5e9a"), ringMid = hex("#e9c79a"), ringOut = hex("#c9b0e8");
    const moonC = pal(["#5d5678", "#a89c9a", "#e8dccb", "#fff6e6"]);
    const put = (x: number, y: number, c: RGB, k = 1) => { const i = (y * bw + x) * 4; pd[i] = c[0] * k; pd[i + 1] = c[1] * k; pd[i + 2] = c[2] * k; pd[i + 3] = 255; };
    const ccx = cx - bx, ccy = cy - by;
    const ringPass = (back: boolean) => {
      for (let y = 0; y < bh; y++)
        for (let x = 0; x < bw; x++) {
          const dx = x + 0.5 - ccx, dy = y + 0.5 - ccy, u = dx * cph + dy * sph, v = -dx * sph + dy * cph;
          if (back ? v >= 0 : v < 0) continue;
          const e = (u / A) ** 2 + (v / B) ** 2;
          if (e < 0.5 || e > 1 || (e > 0.79 && e < 0.83)) continue;
          const c = e < 0.62 ? ringIn : e < 0.79 ? ringMid : ringOut, alpha = e < 0.62 ? 0.55 : e > 0.96 ? 0.5 : 0.9;
          if (bay(x, y) <= alpha) put(x, y, c, back ? 0.72 : 1);
        }
    };
    const moon = (t: number, front: boolean) => {
      const th = t * 0.24, s = Math.sin(th);
      if (s > 0 !== front) return;
      const mu = A * 0.98 * Math.cos(th), mv = B * 1.03 * s, mx = ccx + mu * cph - mv * sph, my = ccy + mu * sph + mv * cph, mr = 3.4 * U;
      for (let y = Math.floor(my - mr); y <= my + mr; y++)
        for (let x = Math.floor(mx - mr); x <= mx + mr; x++) {
          if (x < 0 || y < 0 || x >= bw || y >= bh) continue;
          const nx = (x + 0.5 - mx) / mr, ny = (y + 0.5 - my) / mr, q = nx * nx + ny * ny;
          if (q > 1) continue;
          const d = Math.max(0, (nx * Lx + ny * Ly + Math.sqrt(1 - q) * Lz) / Ln);
          put(x, y, moonC[clamp(Math.floor(d * 3.4 + bay(x, y) * 0.9), 0, 3)]);
        }
    };
    const planet = (t: number) => {
      const rot = t * 0.06;
      for (let y = Math.floor(ccy - R - 2); y <= ccy + R + 2; y++)
        for (let x = Math.floor(ccx - R - 2); x <= ccx + R + 2; x++) {
          if (x < 0 || y < 0 || x >= bw || y >= bh) continue;
          const nx = (x + 0.5 - ccx) / R, ny = (y + 0.5 - ccy) / R, q = nx * nx + ny * ny;
          if (q > 1) {
            if (q < 1.12) { const lit = Math.max(0, (nx * Lx + ny * Ly) / Ln); if (bay(x, y) < lit * 0.9 * (1.12 - q) * 8) put(x, y, atm, 0.8); }
            continue;
          }
          const nz = Math.sqrt(1 - q), u = nx * cph + ny * sph, v = -nx * sph + ny * cph, lat = Math.asin(clamp(v, -1, 1)), lon = Math.atan2(u, nz) + rot;
          const f = (lat / 1.5708) * 4.4 + 0.22 * Math.sin(lon * 2 + lat * 9) + 0.1 * Math.sin(lon * 5 - lat * 3);
          let c = bands[(((Math.floor(f + 9) % bands.length) + bands.length) % bands.length)];
          let dl = (((lon - 1.2) % 6.283) + 6.283) % 6.283;
          if (dl > 3.14) dl -= 6.283;
          const sd = (dl / 0.38) ** 2 + ((lat - 0.3) / 0.12) ** 2;
          if (sd < 1) c = sd < 0.45 ? spot : spotRim;
          const dif = Math.max(0, (nx * Lx + ny * Ly + nz * Lz) / Ln);
          put(x, y, c, [0.2, 0.42, 0.7, 1][clamp(Math.floor(dif * 3.6 + bay(x, y) - 0.25), 0, 3)]);
          if (nz < 0.22 && dif > 0.08 && bay(y, x) < (0.22 - nz) * 3) put(x, y, atm, 0.9);
        }
    };
    bias = ["흰빛", "은빛", "얼음", "라벤더", "금빛"];
    return {
      every: [[sporadic, 1.6, 4]],
      comet: [() => crossComet({ speed: [15, 20], ion: P.ion, dust: P.white, coma: "#d6e6ff" }), 13, 19],
      draw: (t) => {
        const rot = t * (6.2832 / 480);
        for (const s of sky) {
          const a = s.a + rot, x = pxp + Math.cos(a) * s.r, y = pyp + Math.sin(a) * s.r;
          if (x < -1 || y < -1 || x > cw || y > ch) continue;
          splat(x, y, s.c, s.b * (1 - s.amp + s.amp * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph))));
        }
        const pp = 0.8 + 0.2 * Math.sin(t * 1.3), px0 = Math.round(pxp), py0 = Math.round(pyp);
        add(px0, py0, north, 1.6 * pp);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) add(px0 + dx, py0 + dy, north, 0.6 * pp);
      },
      post: (t) => { pd.fill(0); ringPass(true); moon(t, false); planet(t); ringPass(false); moon(t, true); pg.putImageData(pim, 0, 0); },
    };
  }

  function s5(): Scene {
    paint(layer(cw, ch, 0, 0, 1), ditherGrad(pal(["#020616", "#040a20", "#06102a", "#091634", "#0c1b3c", "#101e44", "#151f4a", "#1a1f4e"])));
    const fg = layer(cw, ch, 0, 0, 3), ridge = (x: number) => ch * 0.86 - fbm(x * 0.04 * Q, 7) * ch * 0.09, trees: [number, number][] = [];
    for (let x = 0; x < cw; x += Math.max(2, Math.floor(rnd(3, 7) * U))) trees.push([x, rnd(0.55, 1)]);
    const T1 = hex("#070c18"), T2 = hex("#16243a"), T3 = hex("#060a14");
    paint(fg, (x, y) => {
      if (y >= ridge(x)) return T1;
      for (const [tx, s] of trees) { const top = ridge(tx) - 12 * U * s, dy = y - top; if (dy >= 0 && y < ridge(tx) + 2 && Math.abs(x - tx) <= dy * 0.38 + 0.2) return dy < 2 && bay(x, y) < 0.4 ? T2 : T3; }
      return null;
    });
    bias = ["초록", "청록", "연두", "시안", "흰빛", "라벤더"];
    const stars = makeStars(0.01, ["#ffffff", "#d6e6ff", "#a9c8ff", "#d6ffe8"], 0.85);
    const aur = pal(["#c9ffe2", "#7dffb0", "#3ff0a0", "#2bd6b0", "#2fa8d8", "#6a7cf0", "#a06cf0", "#d07ce8"]);
    const curtain = (t: number, y0: number, k: number, s: number, p: number, amp: number) => {
      for (let x = 0; x < cw; x++) {
        const X = x * Q;
        const base = ch * y0 + ch * 0.03 * Math.sin(X * 0.022 * k + t * 0.2 * s) + ch * 0.016 * Math.sin(X * 0.061 * k - t * 0.33 * s) + ch * 0.01 * Math.sin(X * 0.13 + t * 0.55);
        let I = 0.5 + 0.5 * Math.sin(X * 0.02 * k - t * 0.28 * s + p) * Math.sin(X * 0.047 + t * 0.16 + p);
        I = Math.max(0, I) * (0.7 + 0.3 * Math.sin(X * 0.42 + t * 1.2 + Math.sin(X * 0.09 + t * 0.3) * 2.2)) * amp;
        if (I < 0.02) continue;
        const Hc = ch * (0.12 + 0.09 * (0.5 + 0.5 * Math.sin(X * 0.016 + t * 0.11 + p)));
        for (let y = Math.floor(base - Hc); y <= base + 3 * U; y++) {
          const v = (base - y) / Hc, a = y > base ? Math.exp(-((y - base) / U) * 0.9) : Math.pow(1 - v, 1.3) * (0.55 + 0.45 * Math.exp(-(base - y) / (2.2 * U)));
          add(x, y, grad(aur, clamp(v * 0.95 + 0.05, 0, 1)), I * a * 0.85);
        }
      }
    };
    return {
      every: [[sporadic, 1.6, 4]],
      comet: [() => crossComet({ speed: [15, 20], ion: P.ion, dust: P.green, coma: "#d6ffe8", curve: 2.5 }), 14, 21],
      draw: (t) => { curtain(t, 0.34, 1, 1, 0, 1); curtain(t, 0.25, 1.6, 0.7, 2.1, 0.6); drawStars(stars, t); },
    };
  }

  const scene = [s1, s2, s3, s4, s5][clamp(o.scene, 1, 5) - 1]();
  const timers = scene.every.map((e) => ({ f: e[0], a: e[1], b: e[2], left: rnd(0.2, e[1]) }));
  let cometT = scene.comet ? 0.4 : 1e9, T = 0, last = 0, raf = 0, dead = false;
  function step(dt: number) {
    T += dt;
    for (const tm of timers) { tm.left -= dt; if (tm.left <= 0) { tm.f(); tm.left = rnd(tm.a, tm.b); } }
    if (scene.comet) { cometT -= dt; if (cometT <= 0) { scene.comet[0](); cometT = rnd(scene.comet[1], scene.comet[2]); } }
    stepMeteors(dt); stepComets(dt); stepParts(dt); stepFx(dt);
  }
  function render() {
    scene.draw(T); drawComets(T); drawParts(); drawMeteors(T); drawFx(); flush();
    scene.post?.(T);
  }
  function frame(now: number) {
    if (dead) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    step(dt); render();
    raf = requestAnimationFrame(frame);
  }
  if (o.still) { while (T < 5) step(1 / 30); render(); }
  else raf = requestAnimationFrame(frame);

  return {
    stop() { dead = true; cancelAnimationFrame(raf); host.innerHTML = ""; parts = []; meteors = []; comets = []; fxs = []; },
    boom(cx?: number, cy?: number) {
      if (o.still) return;
      // 한 점에서 만나게: 큰 별똥별 하나에 작은 것 서넛이 사방 위에서 같은 때 닿아 작은 것들이 터진다 (제작자 2026-11-13 '빈 곳 클릭하면 충돌해서 터지는 거 볼 수 있게 많이 떨어지게')
      let mx = cw * rnd(0.4, 0.6), my = ch * rnd(0.25, 0.4);
      if (cx !== undefined && cy !== undefined) {
        const r = host.getBoundingClientRect();
        mx = clamp((cx - r.left) / S, 2, cw - 2);
        my = clamp((cy - r.top) / S, 2, ch - 2);
      }
      const tm = rnd(0.9, 1.2), cols = Object.keys(MCOL);
      const send = (ang: number, size: number, t: number) => {
        const a = (ang * Math.PI) / 180, z = SIZES[size], sp = rnd(z.sp[0], z.sp[1]) * U, from = { x: mx - Math.cos(a) * sp * t, y: my - Math.sin(a) * sp * t };
        launch(mx, my, ang, from, { size, col: pick(cols), sp }, { split: -1 });
      };
      const big = Math.random() < 0.5 ? rnd(25, 45) : rnd(135, 155);
      send(big, pick([3, 4]), tm);
      // 작은 것들은 큰 것과 30도 넘게 벌어진 방향에서 (평행하게 겹치지 않게)
      const n = 3 + Math.floor(Math.random() * 2), used = [big];
      for (let i = 0; i < n; i++) {
        let ang = rnd(20, 160);
        for (let k = 0; k < 12 && used.some((u) => Math.abs(u - ang) < 22); k++) ang = rnd(20, 160);
        used.push(ang);
        send(ang, pick([0, 1, 1, 2]), tm);
      }
      // 둘레로 별똥별 비도 조금
      for (let i = 0; i < 5; i++) window.setTimeout(() => !dead && sporadic(), 150 + i * 220);
    },
  };
}
