// 생일 스티커 효과 엔진 (src/birthday.tsx): 화면 전체를 덮는 캔버스 하나에 불꽃놀이·색종이·하트·풍선을 그린다.
// 누를 때만 돌고(파티클이 다 사라지면 멈춤), 누르는 데 걸리지 않는다(pointer-events: none). 파티클은 1800개까지.
// 프레임이 느려지면(아주 빠른 연타, 느린 폰) 저절로 가볍게: 파티클 수를 줄이고 새로 생기는 것을 솎고 캔버스 해상도를 낮춘다
// (제작자 2026-11-08 '누가 엄청 빠르게 누르니까 멈췄대', `quality`).

type Shape = "dot" | "spark" | "square" | "confetti" | "heart" | "balloon" | "flash" | "ring" | "none";

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 중력 (px/s²) */
  g: number;
  /** 1초에 남는 속도 비율 (1 = 그대로) */
  drag: number;
  life: number;
  max: number;
  size: number;
  color: string;
  shape: Shape;
  rot: number;
  vrot: number;
  /** 빛을 더하는 그리기 (불꽃) */
  add: boolean;
  delay: number;
  trail?: number[];
  trailLen?: number;
  twinkle?: boolean;
  flutter?: number;
  sway?: number;
  /** 커지는 속도 (번쩍임·고리) */
  grow?: number;
  emit?: (p: P, dt: number) => void;
  end?: (p: P) => void;
}

export const PALETTE = ["#ff4d8d", "#ffc35c", "#6f8fff", "#7ee2a8", "#c58bff", "#ff8a3d", "#5ce1ff", "#fff27a", "#ff6b6b"];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const MAX = 1800;
/** 가장 가벼울 때의 파티클 수 */
const MIN_CAP = 260;

const HEART = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"];

export class Fx {
  private cv: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private ps: P[] = [];
  private raf = 0;
  private last = 0;
  private dpr = 1;
  w = 0;
  h = 0;
  private glow = new Map<string, HTMLCanvasElement>();
  private heartPics = new Map<string, HTMLCanvasElement>();
  private onResize = () => this.size();
  /** 최근 프레임 시간(ms, 평균)과 그에 따른 품질 0.2~1 (1 = 다 그림) */
  private ft = 16;
  quality = 1;
  /** 지금 캔버스 배율 (느리면 1 로 낮춘다) */
  private lowRes = false;

  mount() {
    if (this.cv) return;
    const cv = document.createElement("canvas");
    cv.className = "bday-canvas";
    cv.setAttribute("aria-hidden", "true");
    document.body.appendChild(cv);
    this.cv = cv;
    this.ctx = cv.getContext("2d");
    this.size();
    window.addEventListener("resize", this.onResize);
  }
  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener("resize", this.onResize);
    this.cv?.remove();
    this.cv = null;
    this.ctx = null;
    this.ps = [];
  }
  /** 캔버스 흔들기 (8비트 안) */
  shake() {
    const cv = this.cv;
    if (!cv) return;
    cv.classList.remove("bday-shake");
    void cv.offsetWidth;
    cv.classList.add("bday-shake");
  }
  private size() {
    if (!this.cv) return;
    this.dpr = this.lowRes ? 1 : Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.cv.width = Math.round(this.w * this.dpr);
    this.cv.height = Math.round(this.h * this.dpr);
  }
  add(p: Partial<P> & { x: number; y: number }) {
    // 30fps 아래로 끊길 때만 덜어 낸다 (잘 도는 폰은 다 그린다, 제작자 2026-11-08 '효과 줄이지 마')
    const keep = Math.min(1, this.quality / 0.6);
    if (this.ps.length >= MIN_CAP + (MAX - MIN_CAP) * keep) return;
    // 끊길 때는 꾸밈 가루(반짝이·불똥·색종이)부터 솎는다. 터지는 씨앗(end)·풍선·번쩍임·고리는 그대로
    if (keep < 1 && !p.end && !p.emit && p.shape !== "balloon" && p.shape !== "flash" && p.shape !== "ring" && Math.random() > keep) return;
    this.ps.push({
      vx: 0,
      vy: 0,
      g: 0,
      drag: 1,
      life: 0,
      max: 1,
      size: 3,
      color: "#fff",
      shape: "dot",
      rot: 0,
      vrot: 0,
      add: true,
      delay: 0,
      ...p,
    });
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }
  private glowOf(color: string) {
    let c = this.glow.get(color);
    if (!c) {
      c = document.createElement("canvas");
      c.width = c.height = 32;
      const x = c.getContext("2d")!;
      const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, "#ffffff");
      gr.addColorStop(0.25, color);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = gr;
      x.fillRect(0, 0, 32, 32);
      this.glow.set(color, c);
    }
    return c;
  }
  /** 도트 하트 그림 (색·크기마다 한 번 그려 두고 붙인다: 칸마다 fillRect 42번 대신) */
  private heartOf(color: string, u: number) {
    const k = `${color}|${u}`;
    let c = this.heartPics.get(k);
    if (!c) {
      c = document.createElement("canvas");
      c.width = 7 * u;
      c.height = 6 * u;
      const x = c.getContext("2d")!;
      x.fillStyle = color;
      for (let y = 0; y < HEART.length; y++) for (let i = 0; i < 7; i++) if (HEART[y][i] === "1") x.fillRect(i * u, y * u, u, u);
      x.fillStyle = "rgba(255,255,255,0.7)";
      x.fillRect(u, u, u, u);
      this.heartPics.set(k, c);
    }
    return c;
  }
  private tick = (t: number) => {
    const raw = t - this.last;
    const dt = Math.min(0.05, raw / 1000);
    this.last = t;
    // 프레임이 느리면 품질을 낮추고(빠르게), 다시 빨라지면 천천히 올린다
    this.ft = this.ft * 0.85 + Math.min(raw, 250) * 0.15;
    // 45fps 보다 빠르면 1 (아무것도 안 줄임), 그보다 느려질수록 낮춘다
    const want = Math.max(0.2, Math.min(1, 1 - (this.ft - 22) / 28));
    this.quality = want < this.quality ? want : this.quality + (want - this.quality) * 0.04;
    if (!this.lowRes && this.quality < 0.4) {
      this.lowRes = true;
      this.size();
    }
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    // 이번 프레임에 새로 생긴 것(터진 불꽃, 흘린 불똥)은 새 목록에 바로 들어간다
    const cur = this.ps;
    this.ps = [];
    for (const p of cur) {
      if (p.delay > 0) {
        p.delay -= dt;
        this.ps.push(p);
        continue;
      }
      p.life += dt;
      if (p.life >= p.max) {
        p.end?.(p);
        continue;
      }
      const k = Math.pow(p.drag, dt);
      p.vx *= k;
      p.vy = p.vy * k + p.g * dt;
      if (p.sway) p.vx += Math.sin(p.life * 3 + p.rot) * p.sway * dt;
      if (p.trailLen) {
        const tr = (p.trail ??= []);
        tr.push(p.x, p.y);
        if (tr.length > p.trailLen * 2) tr.splice(0, tr.length - p.trailLen * 2);
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      p.emit?.(p, dt);
      this.ps.push(p);
    }
    this.draw(ctx);
    if (this.ps.length) this.raf = requestAnimationFrame(this.tick);
    else {
      this.raf = 0;
      ctx.clearRect(0, 0, this.w, this.h);
      // 다 끝나면 다음을 위해 다시 또렷하게 (품질은 다음 프레임부터 다시 잰다)
      this.ft = 16;
      this.quality = 1;
      if (this.lowRes) {
        this.lowRes = false;
        this.size();
      }
    }
  };
  private draw(ctx: CanvasRenderingContext2D) {
    for (const pass of [false, true]) {
      ctx.globalCompositeOperation = pass ? "lighter" : "source-over";
      for (const p of this.ps) {
        if (p.add !== pass || p.delay > 0 || p.shape === "none") continue;
        const r = p.life / p.max;
        let a = r < 0.7 ? 1 : 1 - (r - 0.7) / 0.3;
        if (p.twinkle && r > 0.45) a *= Math.random() < 0.5 ? 0.25 : 1;
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        switch (p.shape) {
          case "dot": {
            const s = p.size * 4;
            ctx.drawImage(this.glowOf(p.color), p.x - s / 2, p.y - s / 2, s, s);
            break;
          }
          case "spark": {
            const tr = p.trail;
            const lite = this.quality < 0.45;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.size;
            ctx.lineCap = "round";
            ctx.beginPath();
            if (tr && tr.length >= 2) ctx.moveTo(tr[0], tr[1]);
            else ctx.moveTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            if (lite) break;
            const s = p.size * 3.2;
            ctx.drawImage(this.glowOf(p.color), p.x - s / 2, p.y - s / 2, s, s);
            break;
          }
          case "square": {
            const s = Math.max(2, Math.round(p.size));
            ctx.fillStyle = p.color;
            ctx.fillRect(Math.round(p.x / 3) * 3 - s / 2, Math.round(p.y / 3) * 3 - s / 2, s, s);
            break;
          }
          case "confetti": {
            // save/restore 대신 변환을 한 번에 (가볍게)
            const d = this.dpr;
            const c = Math.cos(p.rot);
            const sn = Math.sin(p.rot);
            const sy = Math.cos(p.life * (p.flutter ?? 8));
            ctx.setTransform(d * c, d * sn, -d * sn * sy, d * c * sy, d * p.x, d * p.y);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size / 2, -p.size * 0.35, p.size, p.size * 0.7);
            ctx.setTransform(d, 0, 0, d, 0, 0);
            break;
          }
          case "heart": {
            const u = Math.max(1, Math.round(p.size / 7));
            ctx.drawImage(this.heartOf(p.color, u), Math.round(p.x - 3.5 * u), Math.round(p.y - 3 * u));
            break;
          }
          case "balloon": {
            const s = p.size;
            ctx.strokeStyle = "rgba(255,255,255,0.55)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y + s * 1.1);
            ctx.quadraticCurveTo(p.x + Math.sin(p.life * 4) * 6, p.y + s * 1.9, p.x, p.y + s * 2.8);
            ctx.stroke();
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, s * 0.82, s, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(p.x - s * 0.15, p.y + s * 1.12);
            ctx.lineTo(p.x + s * 0.15, p.y + s * 1.12);
            ctx.lineTo(p.x, p.y + s * 0.95);
            ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,0.55)";
            ctx.beginPath();
            ctx.ellipse(p.x - s * 0.3, p.y - s * 0.35, s * 0.16, s * 0.28, -0.5, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
          case "flash": {
            const s = p.size + (p.grow ?? 0) * p.life;
            ctx.globalAlpha = a * (1 - r);
            ctx.drawImage(this.glowOf(p.color), p.x - s / 2, p.y - s / 2, s, s);
            break;
          }
          case "ring": {
            const s = p.size + (p.grow ?? 0) * p.life;
            ctx.globalAlpha = 1 - r;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 3 * (1 - r) + 1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
            ctx.stroke();
            break;
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // ---------------- 효과 ----------------

  /** 번쩍임 */
  flash(x: number, y: number, color: string, size = 30, grow = 260, delay = 0) {
    this.add({ x, y, shape: "flash", color, size, grow, max: 0.45, delay });
  }
  ring(x: number, y: number, color: string, grow = 260, delay = 0, max = 0.7) {
    this.add({ x, y, shape: "ring", color, size: 6, grow, max, delay, add: false });
  }
  /** 불꽃 하나가 터진다 */
  explode(x: number, y: number, pattern: string, colors: string[], scale = 1, delay = 0) {
    const c1 = colors[0];
    const c2 = colors[1] ?? colors[0];
    this.flash(x, y, c1, 26 * scale, 300 * scale, delay);
    const sp = (s: number) => s * scale;
    if (pattern === "ring" || pattern === "peony" || pattern === "double") {
      const n = pattern === "ring" ? 46 : 72;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (pattern === "ring" ? 0 : rnd(-0.08, 0.08));
        const v = pattern === "ring" ? sp(190) : sp(rnd(120, 210));
        this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 70, drag: 0.32, max: rnd(1.1, 1.6), size: 2, color: i % 2 ? c1 : c2, shape: "spark", trailLen: 4, twinkle: true, delay });
      }
      if (pattern === "double")
        for (let i = 0; i < 36; i++) {
          const a = (i / 36) * Math.PI * 2;
          this.add({ x, y, vx: Math.cos(a) * sp(90), vy: Math.sin(a) * sp(90), g: 60, drag: 0.3, max: 1.3, size: 2.4, color: "#ffffff", shape: "dot", twinkle: true, delay });
        }
    } else if (pattern === "willow") {
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const v = sp(rnd(110, 160));
        this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 55, drag: 0.42, max: rnd(2.2, 3), size: 1.6, color: "#ffd27a", shape: "spark", trailLen: 9, twinkle: true, delay });
      }
    } else if (pattern === "heart") {
      for (let i = 0; i < 64; i++) {
        const t = (i / 64) * Math.PI * 2;
        const hx = 16 * Math.pow(Math.sin(t), 3);
        const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        this.add({ x, y, vx: hx * sp(9), vy: hy * sp(9), g: 30, drag: 0.25, max: 1.6, size: 2.2, color: i % 3 ? "#ff4d8d" : "#ffd1e3", shape: "spark", trailLen: 3, twinkle: true, delay });
      }
    } else if (pattern === "star") {
      for (let i = 0; i < 80; i++) {
        const t = (i / 80) * Math.PI * 2;
        const k = 0.55 + 0.45 * Math.cos(5 * t);
        this.add({ x, y, vx: Math.cos(t - Math.PI / 2) * sp(200) * k, vy: Math.sin(t - Math.PI / 2) * sp(200) * k, g: 50, drag: 0.3, max: 1.5, size: 2, color: i % 2 ? c1 : "#fff6b0", shape: "spark", trailLen: 3, twinkle: true, delay });
      }
    } else if (pattern === "crossette") {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        this.add({
          x, y, vx: Math.cos(a) * sp(150), vy: Math.sin(a) * sp(150), g: 50, drag: 0.4, max: 0.55, size: 2.6, color: c1, shape: "spark", trailLen: 5, delay,
          end: (p) => {
            for (let j = 0; j < 4; j++) {
              const b = (j / 4) * Math.PI * 2 + Math.PI / 4;
              this.add({ x: p.x, y: p.y, vx: Math.cos(b) * sp(110), vy: Math.sin(b) * sp(110), g: 60, drag: 0.35, max: 0.9, size: 1.8, color: c2, shape: "spark", trailLen: 4, twinkle: true });
            }
          },
        });
      }
    } else if (pattern === "pixel") {
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        const v = sp(rnd(90, 190));
        this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 140, drag: 0.4, max: rnd(0.9, 1.4), size: rnd(4, 7), color: pick(colors.length > 1 ? colors : PALETTE), shape: "square", add: false, delay });
      }
    }
    // 끝에 반짝이 가루
    for (let i = 0; i < 18; i++)
      this.add({ x: x + rnd(-60, 60) * scale, y: y + rnd(-50, 60) * scale, vy: 20, g: 20, max: rnd(0.6, 1.2), size: 1.4, color: "#ffffff", shape: "dot", twinkle: true, delay: delay + rnd(0.5, 0.9) });
  }
  /** 화면 아래에서 쏘아 올려 그 자리에서 터진다 */
  rocket(x0: number, y0: number, x1: number, y1: number, pattern: string, colors: string[], delay = 0, scale = 1) {
    const T = rnd(0.7, 1);
    this.add({
      x: x0, y: y0, vx: (x1 - x0) / T, vy: (y1 - y0) / T, max: T, size: 2.4, color: "#ffe9a8", shape: "spark", trailLen: 6, delay,
      emit: (p) => {
        if (Math.random() < 0.7) this.add({ x: p.x, y: p.y, vx: rnd(-20, 20), vy: rnd(10, 40), g: 120, max: rnd(0.3, 0.6), size: 1.4, color: "#ffb84d", shape: "dot" });
      },
      end: (p) => this.explode(p.x, p.y, pattern, colors, scale),
    });
  }
  /** 색종이: 한 점에서 각도 범위로 */
  confetti(x: number, y: number, angle: number, spread: number, n: number, speed: [number, number], delay = 0) {
    for (let i = 0; i < n; i++) {
      const a = angle + rnd(-spread, spread);
      const v = rnd(speed[0], speed[1]);
      this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 380, drag: 0.18, max: rnd(2.2, 3.4), size: rnd(6, 10), color: pick(PALETTE), shape: "confetti", rot: rnd(0, 6), vrot: rnd(-8, 8), flutter: rnd(6, 14), sway: 40, add: false, delay: delay + rnd(0, 0.08) });
    }
  }
  /** 위에서 색종이 비 */
  confettiRain(n: number, delay = 0) {
    for (let i = 0; i < n; i++)
      this.add({ x: rnd(0, this.w), y: rnd(-80, -10), vx: rnd(-30, 30), vy: rnd(60, 160), g: 60, drag: 0.6, max: rnd(3, 4.5), size: rnd(6, 10), color: pick(PALETTE), shape: "confetti", rot: rnd(0, 6), vrot: rnd(-6, 6), flutter: rnd(6, 12), sway: 60, add: false, delay: delay + rnd(0, 1.2) });
  }
  hearts(x: number, y: number, n: number, spread = 120, delay = 0) {
    for (let i = 0; i < n; i++) {
      const a = rnd(-Math.PI * 0.95, -Math.PI * 0.05);
      const v = rnd(60, spread * 1.6);
      this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: -20, drag: 0.35, max: rnd(1.2, 2), size: rnd(9, 16), color: pick(["#ff4d8d", "#ff6b9e", "#ff9ec4", "#e83a6f", "#ffb3d1"]), shape: "heart", sway: 30, add: false, delay: delay + rnd(0, 0.15) });
    }
  }
  heartRain(n: number, delay = 0) {
    for (let i = 0; i < n; i++)
      this.add({ x: rnd(0, this.w), y: rnd(-60, -10), vy: rnd(70, 140), g: 20, drag: 0.8, max: rnd(3, 4.5), size: rnd(10, 18), color: pick(["#ff4d8d", "#ff6b9e", "#ff9ec4", "#e83a6f"]), shape: "heart", sway: 50, add: false, delay: delay + rnd(0, 1.4) });
  }
  balloons(n: number, delay = 0) {
    for (let i = 0; i < n; i++)
      this.add({ x: rnd(20, this.w - 20), y: this.h + rnd(20, 60), vx: rnd(-10, 10), vy: rnd(-150, -100), max: rnd(4.5, 6), size: rnd(13, 19), color: pick(PALETTE), shape: "balloon", sway: 25, add: false, rot: rnd(0, 6), delay: delay + rnd(0, 0.6) });
  }
  /** 지금 떠 있는 풍선이 있는지 (누른 곳 풍선 찾기는 이때만) */
  hasBalloons() {
    return this.ps.some((p) => p.shape === "balloon" && p.delay <= 0 && p.life < p.max);
  }
  /**
   * 누른 곳의 풍선을 터뜨린다 (제작자 2026-11-07 '풍선 올라가는 것도 누르면 터지게'). 터뜨렸으면 그 자리와 색.
   * 손가락이라 풍선 몸통보다 넉넉히 잡는다
   */
  popAt(x: number, y: number): { x: number; y: number; color: string } | null {
    let hit: P | null = null;
    let best = 1;
    for (const p of this.ps) {
      if (p.shape !== "balloon" || p.delay > 0 || p.life >= p.max) continue;
      const d = Math.hypot((x - p.x) / (p.size + 14), (y - (p.y + p.size * 0.3)) / (p.size * 1.4 + 14));
      if (d < best) {
        best = d;
        hit = p;
      }
    }
    if (!hit) return null;
    hit.shape = "none";
    hit.max = hit.life;
    const { x: bx, y: by, color } = hit;
    this.flash(bx, by, "#ffffff", 18, 200);
    this.ring(bx, by, color, 170, 0, 0.35);
    this.ring(bx, by, "#ffffff", 110, 0.05, 0.25);
    // 터지면 작은 불꽃놀이 + 사방으로 색종이 + 반짝이 (제작자 2026-11-07 '풍선이 터지면 엄청난 종이와 반짝이와 폭죽이 터지게')
    this.explode(bx, by, pick(["peony", "star", "double", "ring", "crossette"]), [color, pick(PALETTE)], 0.75);
    this.explode(bx, by, "pixel", PALETTE, 0.45, 0.12);
    for (let i = 0; i < 56; i++) {
      const a = rnd(0, Math.PI * 2);
      const v = rnd(140, 420);
      this.add({ x: bx, y: by, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, g: 380, drag: 0.22, max: rnd(1.8, 2.8), size: rnd(6, 10), color: pick(PALETTE), shape: "confetti", rot: rnd(0, 6), vrot: rnd(-10, 10), flutter: rnd(6, 14), sway: 40, add: false, delay: rnd(0, 0.06) });
    }
    for (let i = 0; i < 36; i++) {
      const a = rnd(0, Math.PI * 2);
      const v = rnd(60, 260);
      this.add({ x: bx, y: by, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 60, drag: 0.5, max: rnd(0.9, 1.6), size: rnd(1.4, 2.4), color: pick(["#ffffff", "#fff27a", "#ffd27a", color]), shape: "dot", twinkle: true, delay: rnd(0, 0.2) });
    }
    // 고무 조각 (풍선 색) + 불똥
    for (let i = 0; i < 16; i++) {
      const a = rnd(0, Math.PI * 2);
      const v = rnd(120, 280);
      this.add({ x: bx, y: by, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, g: 520, drag: 0.3, max: rnd(0.6, 1.1), size: rnd(4, 8), color, shape: "confetti", rot: rnd(0, 6), vrot: rnd(-14, 14), flutter: rnd(8, 16), add: false });
    }
    for (let i = 0; i < 14; i++) {
      const a = rnd(0, Math.PI * 2);
      const v = rnd(90, 220);
      this.add({ x: bx, y: by, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 120, drag: 0.4, max: rnd(0.4, 0.8), size: 1.6, color: pick([color, "#ffffff", "#fff27a"]), shape: "spark", trailLen: 3, twinkle: true });
    }
    return { x: bx, y: by, color };
  }
  /** 손에 든 불꽃처럼 위로 솟는 금빛 분수 */
  fountain(x: number, y: number, dur = 1.2, delay = 0) {
    this.add({
      x, y, shape: "none", max: dur, delay,
      emit: (p) => {
        for (let i = 0; i < 4; i++) {
          const a = -Math.PI / 2 + rnd(-0.45, 0.45);
          const v = rnd(180, 320);
          this.add({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 420, drag: 0.6, max: rnd(0.6, 1.1), size: 1.6, color: pick(["#ffd27a", "#fff2b8", "#ffb347"]), shape: "spark", trailLen: 3, twinkle: true });
        }
      },
    });
  }
}
