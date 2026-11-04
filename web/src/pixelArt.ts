// 시뮬레이터 던전의 도트 그림 (이 앱이 그린 것, 제작자 2026-11-04 '그림이 허접하다'). 작은 캔버스에 도트로 그리고 화면은 2배로 키운다 (image-rendering: pixelated).
// 모양마다 빛(왼쪽 위)으로 밝은 면·보통·그림자 세 단으로 칠하고, 다 그린 뒤 바깥에 짙은 테두리를 두른다.
// 다른 게임의 그림·캐릭터는 쓰지 않는다 (프로젝트 규칙). 캐릭터 사진을 올린 길드원은 화면이 그 사진(아이모 캐릭터)을 쓴다.

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** 한 색에서 밝은 면·보통·그림자 */
const tones = (base: string): [RGB, RGB, RGB] => {
  const c = hex(base);
  return [mix(c, [255, 248, 230], 0.35), c, mix(c, [20, 12, 40], 0.42)];
};

class Px {
  w: number;
  h: number;
  d: Uint8ClampedArray;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: RGB, a = 255) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = c[0];
    this.d[i + 1] = c[1];
    this.d[i + 2] = c[2];
    this.d[i + 3] = a;
  }
  alpha(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.d[(y * this.w + x) * 4 + 3];
  }
  /** 타원을 빛 방향으로 세 단 칠하기. keep 이 false 인 칸은 건너뛴다 */
  ellipse(cx: number, cy: number, rx: number, ry: number, base: string, keep: (x: number, y: number) => boolean = () => true) {
    const [hi, mid, sh] = tones(base);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny > 1 || !keep(x, y)) continue;
        const d = nx * 0.6 + ny * 0.8;
        this.set(x, y, d < -0.42 ? hi : d > 0.38 ? sh : mid);
      }
  }
  rect(x0: number, y0: number, w: number, h: number, base: string, round = 0) {
    const [hi, mid, sh] = tones(base);
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const cornerX = Math.min(x - x0, x0 + w - 1 - x), cornerY = Math.min(y - y0, y0 + h - 1 - y);
        if (round && cornerX + cornerY < round) continue;
        const nx = (x + 0.5 - (x0 + w / 2)) / (w / 2), ny = (y + 0.5 - (y0 + h / 2)) / (h / 2);
        const d = nx * 0.55 + ny * 0.45;
        this.set(x, y, d < -0.4 ? hi : d > 0.35 ? sh : mid);
      }
  }
  /** 삼각형 (꼭짓점 셋) */
  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, base: string) {
    const [hi, mid, sh] = tones(base);
    const minX = Math.floor(Math.min(ax, bx, cx)), maxX = Math.ceil(Math.max(ax, bx, cx));
    const minY = Math.floor(Math.min(ay, by, cy)), maxY = Math.ceil(Math.max(ay, by, cy));
    const s = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const d1 = s(px, py, ax, ay, bx, by), d2 = s(px, py, bx, by, cx, cy), d3 = s(px, py, cx, cy, ax, ay);
        if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
        const u = (x - minX) / Math.max(1, maxX - minX);
        this.set(x, y, u < 0.3 ? hi : u > 0.7 ? sh : mid);
      }
  }
  /** 바깥 테두리: 비어 있는 칸 중 옆이 칠해진 칸 */
  outline(c: RGB) {
    const out: [number, number][] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (!this.alpha(x, y) && (this.alpha(x - 1, y) || this.alpha(x + 1, y) || this.alpha(x, y - 1) || this.alpha(x, y + 1))) out.push([x, y]);
    for (const [x, y] of out) this.set(x, y, c);
  }
  url() {
    const cv = document.createElement("canvas");
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext("2d")!;
    ctx.putImageData(new ImageData(this.d, this.w, this.h), 0, 0);
    return cv.toDataURL();
  }
}

const OUTLINE = hex("#140f26");
export type Job = "전사" | "레인저" | "마법사" | "무도가";
const JOB: Record<Job, { cloth: string; cape: string; hat: string }> = {
  전사: { cloth: "#a8403f", cape: "#7c2430", hat: "#b9c2d6" },
  레인저: { cloth: "#3f8a5a", cape: "#2c5e40", hat: "#4f9a62" },
  마법사: { cloth: "#5b45b8", cape: "#3a2b80", hat: "#6a4fd0" },
  무도가: { cloth: "#d47a32", cape: "#8c4a1e", hat: "#d8463a" },
};
/** 방어구 강화도마다 몸통 색 (없으면 천옷) */
const ARMOR = ["#9aa3b8", "#7d98e6", "#a77bff", "#f0b64a", "#7fe6e0"];

/** 도트 용사 두 장면(숨 쉬기): 32 x 40, 오른쪽(몬스터)을 본다 */
export function heroFrames(job: Job, armorTier: number | null): [string, string] {
  const key = `${job}:${armorTier}`;
  const hit = HERO_CACHE.get(key);
  if (hit) return hit;
  const out = [0, 1].map((breath) => {
    const p = new Px(32, 40);
    const j = JOB[job];
    const b = breath; // 윗몸이 1칸 내려간다
    const body = armorTier === null ? j.cloth : ARMOR[Math.min(4, armorTier)];
    // 망토 (뒤)
    p.tri(9, 20 + b, 23, 20 + b, 6, 35, j.cape);
    p.tri(23, 20 + b, 26, 35, 6, 35, j.cape);
    // 다리와 신발
    p.rect(11, 30, 4, 6, "#3b3156");
    p.rect(17, 30, 4, 6, "#3b3156");
    p.rect(10, 35, 6, 3, "#2a2036", 1);
    p.rect(16, 35, 6, 3, "#2a2036", 1);
    // 몸통 (방어구 색), 허리띠와 고리
    p.rect(9, 20 + b, 14, 11, body, 2);
    for (let x = 9; x < 23; x++) p.set(x, 28 + b, hex("#6b4326"));
    p.set(15, 28 + b, hex("#ffd36a"));
    p.set(16, 28 + b, hex("#ffd36a"));
    if (armorTier !== null) {
      // 어깨받이
      p.ellipse(9.5, 21.5 + b, 3, 2.4, body);
      p.ellipse(22.5, 21.5 + b, 3, 2.4, body);
      p.set(13, 23 + b, hex("#ffffff"), 170);
    }
    // 팔과 손 (오른손은 무기를 든다)
    p.rect(6, 22 + b, 3, 7, j.cloth, 1);
    p.rect(23, 22 + b, 3, 6, j.cloth, 1);
    p.ellipse(7.5, 29.5 + b, 1.8, 1.6, "#f2c8a0");
    p.ellipse(25, 28.5 + b, 1.8, 1.6, "#f2c8a0");
    // 머리
    p.ellipse(16, 13 + b, 8.5, 8, "#f6d2b0");
    // 머리카락 (위와 옆, 앞머리)
    p.ellipse(16, 10 + b, 9, 6.5, "#4a2d22", (x, y) => y <= 10 + b || x < 9 || x > 23);
    for (const [x, y] of [[10, 11], [11, 12], [13, 11], [15, 12], [18, 11], [20, 12], [22, 11]]) p.set(x, y + b, hex("#3a2219"));
    // 눈 (흰 빛 한 칸), 볼, 입
    for (const ex of [12, 19]) {
      p.set(ex, 14 + b, hex("#24183c"));
      p.set(ex + 1, 14 + b, hex("#24183c"));
      p.set(ex, 15 + b, hex("#24183c"));
      p.set(ex + 1, 15 + b, hex("#24183c"));
      p.set(ex, 14 + b, hex("#ffffff"));
    }
    p.set(10, 17 + b, hex("#ff9a9a"), 200);
    p.set(22, 17 + b, hex("#ff9a9a"), 200);
    p.set(16, 18 + b, hex("#b8544e"));
    // 직업 머리쓰개
    if (job === "전사") {
      p.ellipse(16, 8.5 + b, 9.5, 6.5, j.hat, (_x, y) => y <= 11 + b);
      for (let x = 7; x <= 25; x++) p.set(x, 11 + b, hex("#6d7690"));
      p.rect(15, 1 + b, 3, 5, "#d84a4a", 1);
      p.ellipse(19, 2.5 + b, 3.5, 1.8, "#d84a4a");
    } else if (job === "레인저") {
      p.ellipse(16, 12 + b, 10.5, 10, j.hat, (x, y) => {
        const fx = (x + 0.5 - 16) / 7.2, fy = (y + 0.5 - (14.5 + b)) / 6.5;
        return fx * fx + fy * fy > 1 || y < 9 + b;
      });
      p.tri(6, 8 + b, 11, 4 + b, 3, 16 + b, j.hat);
    } else if (job === "마법사") {
      p.tri(9, 8 + b, 23, 8 + b, 22, -2 + b, j.hat);
      p.ellipse(16, 8.5 + b, 12, 2.6, j.hat);
      for (let x = 10; x <= 22; x++) p.set(x, 6 + b, hex("#ffd36a"));
      p.set(21, 1 + b, hex("#fff2b0"));
    } else {
      p.rect(7, 9 + b, 19, 2, j.hat);
      p.tri(24, 9 + b, 30, 8 + b, 28, 14 + b, j.hat);
      p.tri(24, 10 + b, 29, 15 + b, 25, 16 + b, "#a8332b");
    }
    p.outline(OUTLINE);
    return p.url();
  }) as [string, string];
  HERO_CACHE.set(key, out);
  return out;
}
const HERO_CACHE = new Map<string, [string, string]>();

/** 휘두른 자리의 반달 빛 (32 x 32) */
let SLASH: string | null = null;
export function slashArc(): string {
  if (SLASH) return SLASH;
  const p = new Px(32, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const dx = x + 0.5 - 8, dy = y + 0.5 - 16;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (Math.abs(a) > 1.15) continue;
      const edge = 18 - Math.abs(a) * 4;
      if (r > edge || r < edge - 4 + Math.abs(a) * 2) continue;
      const t = (edge - r) / 4;
      p.set(x, y, t < 0.35 ? [255, 255, 255] : t < 0.7 ? [255, 236, 160] : [255, 190, 90], 235);
    }
  SLASH = p.url();
  return SLASH;
}

/** 던전 뒷배경: 돌벽, 가운데 아치 문, 기둥, 돌바닥, 둘레 어둡게. w x h 도트 (화면은 2배) */
export function backdrop(w: number, h: number, boss: boolean): string {
  const key = `${w}x${h}:${boss}`;
  const hit = BG_CACHE.get(key);
  if (hit) return hit;
  const p = new Px(w, h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
  const wallY = Math.round(h * 0.7);
  const bricks = boss ? ["#3b1a2c", "#44203a", "#351627"] : ["#262650", "#2c2c5a", "#232247"];
  const mortar = hex(boss ? "#1a0a14" : "#14122c");
  const bw = 12, bh = 6;
  for (let row = 0; row * bh < wallY; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let bx = -bw; bx < w + bw; bx += bw) {
      const c = hex(bricks[Math.floor(rnd() * bricks.length)]);
      const x0 = bx + off, y0 = row * bh;
      for (let y = y0; y < y0 + bh && y < wallY; y++)
        for (let x = x0; x < x0 + bw; x++) {
          const edge = y === y0 || x === x0;
          if (edge) p.set(x, y, mortar);
          else if (y === y0 + 1) p.set(x, y, mix(c, [255, 255, 255], 0.12));
          else if (y === y0 + bh - 1) p.set(x, y, mix(c, [0, 0, 0], 0.25));
          else p.set(x, y, c);
        }
    }
  }
  // 가운데 아치 문 (안은 깊은 어둠, 아래로 옅은 빛)
  const ax = Math.round(w / 2), aw = 18, ay = Math.round(wallY * 0.25);
  for (let y = ay; y < wallY; y++)
    for (let x = ax - aw; x <= ax + aw; x++) {
      const top = y < ay + aw ? Math.hypot(x - ax, y - (ay + aw)) <= aw : true;
      if (!top) continue;
      const rim = Math.abs(x - ax) >= aw - 1 || (y < ay + aw && Math.hypot(x - ax, y - (ay + aw)) > aw - 2);
      const glow = (y - ay) / (wallY - ay);
      p.set(x, y, rim ? hex(boss ? "#5a2a3e" : "#3c3a72") : mix(hex("#07060f"), hex(boss ? "#4a1020" : "#1a1a48"), glow * 0.7));
    }
  // 기둥 둘
  for (const cx of [Math.round(w * 0.14), Math.round(w * 0.86)]) {
    for (let y = 0; y < wallY; y++)
      for (let x = cx - 5; x <= cx + 5; x++) {
        const u = (x - (cx - 5)) / 10;
        const col = boss ? ["#5c2a40", "#4a2033", "#2e1220"] : ["#3e3c78", "#302e60", "#1e1c40"];
        p.set(x, y, hex(u < 0.3 ? col[0] : u > 0.75 ? col[2] : col[1]));
      }
    for (let x = cx - 7; x <= cx + 7; x++) {
      p.set(x, 4, mortar);
      p.set(x, wallY - 3, mortar);
      p.set(x, wallY - 2, hex(boss ? "#6a3048" : "#4a4890"));
    }
  }
  // 바닥: 줄마다 어두워지는 돌판, 벽과 만나는 곳에 그림자
  for (let y = wallY; y < h; y++) {
    const depth = (y - wallY) / (h - wallY);
    const rowH = 5 + Math.floor(depth * 4);
    const rowY = Math.floor((y - wallY) / rowH);
    const off = rowY % 2 ? 9 : 0;
    for (let x = 0; x < w; x++) {
      const base = hex(boss ? "#3a1c2e" : "#2e2858");
      let c = mix(base, [10, 8, 24], depth * 0.55);
      if ((x + off) % 18 === 0 || (y - wallY) % rowH === 0) c = mix(c, [8, 6, 18], 0.5);
      if (y === wallY) c = hex(boss ? "#7a3a52" : "#4a3f86");
      if (y === wallY + 1) c = mix(c, [0, 0, 0], 0.45);
      p.set(x, y, c);
    }
  }
  // 둘레 어둡게 (도트 느낌이 남게 4단으로)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = (x - w / 2) / (w / 2), ny = (y - h * 0.45) / (h * 0.7);
      const v = Math.min(1, Math.max(0, Math.hypot(nx, ny) - 0.55));
      const step = Math.floor(v * 4) / 4;
      if (!step) continue;
      const i = (y * w + x) * 4;
      p.d[i] *= 1 - step * 0.55;
      p.d[i + 1] *= 1 - step * 0.55;
      p.d[i + 2] *= 1 - step * 0.45;
    }
  const u = p.url();
  BG_CACHE.set(key, u);
  return u;
}
const BG_CACHE = new Map<string, string>();

/** 횃불 불꽃 세 장면 (8 x 12) */
let FLAMES: string[] | null = null;
export function flames(): string[] {
  if (FLAMES) return FLAMES;
  FLAMES = [0, 1, 2].map((f) => {
    const p = new Px(8, 12);
    const sway = [0, 1, -1][f];
    p.ellipse(4 + sway * 0.5, 7, 3.2, 4.5 - f * 0.4, "#ff8a2a");
    p.ellipse(4 + sway * 0.3, 8, 1.8, 2.8, "#ffd65a");
    p.set(4 + sway, 2 + f, hex("#ffb24a"));
    p.rect(3, 11, 2, 1, "#5a3a22");
    return p.url();
  });
  return FLAMES;
}
