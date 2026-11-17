// 헬스 루틴 종목 애니메이션 (제작자 2026-11-17 '헬스 각 종목마다 도트그래픽 남성이 해당운동 반복으로 하는 애니메이션 넣어줘'):
// 32 x 26 도트 캔버스에 뼈대(머리·몸통·팔·다리)를 각도로 움직이는 작은 엔진. 종목마다 동작 키프레임(또는 때 t 의 함수)과 기구(바벨·덤벨·벤치·케이블·러닝머신 …)를 적어 둔다.
// 그림 파일 없이 코드로 그려서 종목이 늘어도 선만 더하면 되고, 내 종목은 부위·기록 방법으로 비슷한 동작을 쓴다 (`animKeyOf`).
// 화면은 pages/FitAnim.tsx 가 그린다 (보이는 동안만 12fps, 움직임 줄이기면 한 장면).
import type { Exercise, Kind, Part } from "./fit";

export const AW = 32;
export const AH = 26;
/** 바닥 줄 (발이 닿는 곳) */
const G = 24;

type Pt = [number, number];
/** 뼈대 자세. 각도는 도(°): 0 = 아래, 90 = 앞(오른쪽), 180 = 위, -90 = 뒤. 몸통 `to` 는 0 = 똑바로 섬, 90 = 앞으로 수평(머리가 오른쪽) */
export interface Pose {
  hx: number;
  hy: number;
  to: number;
  /** 앞팔 위팔·아래팔 각도 (절대) */
  ua?: number;
  fa?: number;
  /** 뒷팔 (없으면 앞팔과 같게, 조금 뒤에) */
  ua2?: number;
  fa2?: number;
  th?: number;
  sh?: number;
  th2?: number;
  sh2?: number;
  /** 손·발을 한 점에 고정 (IK 로 팔꿈치·무릎을 셈한다) */
  hand?: Pt;
  hand2?: Pt;
  foot?: Pt;
  foot2?: Pt;
  /** IK 로 꺾는 쪽 (팔꿈치 처음 1 = 뒤, 무릎 처음 -1 = 앞) */
  el?: number;
  el2?: number;
  kn?: number;
  kn2?: number;
  /** 어디를 보는지: 1 = 몸통 기준 오른쪽, -1 = 왼쪽 (누워서 위를 보면 머리가 오른쪽일 때 -1) */
  fd?: number;
  /** 발꿈치 들기 0~1 */
  heel?: number;
  /** 뒷팔·뒷다리를 그릴지 */
  arm2?: boolean;
  leg2?: boolean;
}
/** 정면 자세 (옆으로 벌리는 동작) */
export interface FrontPose {
  front: true;
  hx: number;
  hy: number;
  /** 왼팔·오른팔 위팔·아래팔 각도 (0 = 아래, 90 = 옆으로 수평, 180 = 위) */
  al: number;
  bl: number;
  ar: number;
  br: number;
  /** 손을 한 점에 고정 */
  hl?: Pt;
  hr?: Pt;
  /** 다리 벌림 (px) 과 앉은 높이 */
  spread?: number;
  sit?: boolean;
  lean?: number;
}
type AnyPose = Pose | FrontPose;

interface Prop {
  k: string;
  [key: string]: unknown;
}
interface Anim {
  /** 한 바퀴 (ms) */
  dur: number;
  frames?: AnyPose[];
  /** 키프레임 대신 때(0~1)의 함수 */
  pose?: (p: number) => AnyPose;
  props?: Prop[];
}

/* ───────── 그리기 ───────── */
const C = {
  skin: "#f0c8a0",
  skin2: "#c8976c",
  hair: "#3a2a2a",
  shirt: "#4f8ef7",
  shirt2: "#2f5fb8",
  shorts: "#3b3470",
  shorts2: "#27224d",
  shoe: "#e6e6ee",
  shoe2: "#9a9ab0",
  bar: "#d4d8e4",
  plate: "#5a607a",
  plateHi: "#8a90aa",
  db: "#8a90aa",
  bench: "#c84d4d",
  benchHi: "#e06a6a",
  frame: "#6c7290",
  cable: "#e8e8f0",
  floor: "#3b3470",
  floor2: "#27224d",
  belt: "#4a4f66",
  beltHi: "#7c8296",
  gold: "#ffc35c",
  rope: "#e8c070",
};

class Px {
  constructor(private ctx: CanvasRenderingContext2D) {}
  dot(x: number, y: number, c: string) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= AW || iy >= AH) return;
    this.ctx.fillStyle = c;
    this.ctx.fillRect(ix, iy, 1, 1);
  }
  line(a: Pt, b: Pt, c: string, w = 1) {
    let x0 = Math.round(a[0]);
    let y0 = Math.round(a[1]);
    const x1 = Math.round(b[0]);
    const y1 = Math.round(b[1]);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    const steep = dx < -dy;
    for (;;) {
      this.dot(x0, y0, c);
      if (w > 1) (steep ? this.dot(x0 + 1, y0, c) : this.dot(x0, y0 + 1, c));
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) this.dot(x + i, y + j, c);
  }
  circle(cx: number, cy: number, r: number, c: string) {
    const n = Math.max(12, Math.round(r * 6));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.dot(cx + r * Math.cos(a), cy + r * Math.sin(a), c);
    }
  }
}

const D = Math.PI / 180;
const dir = (a: number): Pt => [Math.sin(a * D), Math.cos(a * D)];
const add = (p: Pt, d: Pt, l: number): Pt => [p[0] + d[0] * l, p[1] + d[1] * l];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
/** 두 마디 IK: a 에서 b 까지 길이 l1·l2 로 잇는 가운데 관절 (side 로 꺾는 쪽) */
function ik(a: Pt, b: Pt, l1: number, l2: number, side: number): Pt {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  let d = Math.hypot(dx, dy);
  if (d < 0.01) {
    dx = 0;
    dy = 1;
    d = 1;
  }
  const dd = Math.min(d, l1 + l2 - 0.05);
  const ux = dx / d;
  const uy = dy / d;
  const p = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, l1 * l1 - p * p));
  return [a[0] + ux * p + side * -uy * h, a[1] + uy * p + side * ux * h];
}

const TORSO = 6;
const UPPER = 4;
const FORE = 4;
const THIGH = 5;
const SHIN = 5;

interface Joints {
  hip: Pt;
  sh: Pt;
  head: Pt;
  face: Pt;
  up: Pt;
  elbow: Pt;
  hand: Pt;
  elbow2: Pt;
  hand2: Pt;
  knee: Pt;
  foot: Pt;
  knee2: Pt;
  foot2: Pt;
}

function joints(p: Pose): Joints {
  const hip: Pt = [p.hx, p.hy];
  const up: Pt = [Math.sin(p.to * D), -Math.cos(p.to * D)];
  const sh = add(hip, up, TORSO);
  const head = add(sh, up, 3);
  const fd = p.fd ?? 1;
  // 보는 쪽 = 몸통 방향을 fd 쪽으로 90° 돌린 것
  const face: Pt = fd > 0 ? [-up[1], up[0]] : [up[1], -up[0]];
  const arm = (ua: number, fa: number, pin: Pt | undefined, el: number): [Pt, Pt] => {
    if (pin) return [ik(sh, pin, UPPER, FORE, el), pin];
    const e = add(sh, dir(ua), UPPER);
    return [e, add(e, dir(fa), FORE)];
  };
  const leg = (th: number, shn: number, pin: Pt | undefined, kn: number): [Pt, Pt] => {
    if (pin) return [ik(hip, pin, THIGH, SHIN, kn), pin];
    const k = add(hip, dir(th), THIGH);
    return [k, add(k, dir(shn), SHIN)];
  };
  const ua = p.ua ?? 0;
  const fa = p.fa ?? ua;
  const th = p.th ?? 0;
  const shn = p.sh ?? th;
  const [elbow, hand] = arm(ua, fa, p.hand, p.el ?? 1);
  const [elbow2, hand2] = arm(p.ua2 ?? ua, p.fa2 ?? (p.ua2 !== undefined ? (p.fa2 ?? p.ua2) : fa), p.hand2 ?? (p.ua2 === undefined ? p.hand : undefined), p.el2 ?? p.el ?? 1);
  const [knee, foot] = leg(th, shn, p.foot, p.kn ?? -1);
  const [knee2, foot2] = leg(p.th2 ?? th, p.sh2 ?? (p.th2 !== undefined ? (p.sh2 ?? p.th2) : shn), p.foot2 ?? (p.th2 === undefined ? p.foot : undefined), p.kn2 ?? p.kn ?? -1);
  return { hip, sh, head, face, up, elbow, hand, elbow2, hand2, knee, foot, knee2, foot2 };
}

function drawSide(px: Px, p: Pose, j: Joints, props: Prop[], t: number) {
  const back = (q: Pt): Pt => [q[0] - 1, q[1]];
  const fd = p.fd ?? 1;
  const heel = p.heel ?? 0;
  const footLine = (f: Pt, c: string, c2: string) => {
    // 발: 보는 쪽으로 2칸, 발꿈치를 들면 뒤가 올라간다
    const toe = add(f, j.face, 1.6);
    const h: Pt = [f[0], f[1] - heel * 1.2];
    px.dot(h[0], h[1], c2);
    px.line(h, toe, c);
  };
  for (const pr of props) if (pr.z === -1) drawProp(px, pr, j, t);
  // 뒷다리 · 뒷팔 (어둡게)
  if (p.leg2 !== false) {
    px.line(back(j.hip), back(j.knee2), C.shorts2);
    px.line(back(j.knee2), back(j.foot2), C.skin2);
    footLine(back(j.foot2), C.shoe2, C.shoe2);
  }
  if (p.arm2 !== false) {
    px.line(back(j.sh), back(j.elbow2), C.skin2, 2);
    px.line(back(j.elbow2), back(j.hand2), C.skin2);
    for (const pr of props) if (pr.at === "hand2") drawProp(px, pr, j, t, true);
  }
  for (const pr of props) if (pr.z === 0) drawProp(px, pr, j, t);
  // 몸통: 허리는 2칸, 가슴·어깨는 3칸 굵기로 위로 갈수록 넓게 (제작자 2026-11-17 '상체가 좀 더 빵빵한 녀석'), 어깨는 둥근 덩어리
  const off: Pt = [Math.round(j.face[0]), Math.round(j.face[1])];
  if (off[0] === 0 && off[1] === 0) off[0] = 1;
  const shift = (q: Pt, n = 1): Pt => [q[0] + off[0] * n, q[1] + off[1] * n];
  const hipTop = add(j.hip, j.up, 1.5);
  const chest = add(j.hip, j.up, 3.5);
  px.line(j.hip, hipTop, C.shorts);
  px.line(shift(j.hip), shift(hipTop), C.shorts);
  px.line(hipTop, j.sh, C.shirt);
  px.line(shift(hipTop), shift(j.sh), C.shirt2);
  px.line(shift(chest, -1), shift(j.sh, -1), C.shirt2);
  px.line(shift(chest, 2), shift(j.sh, 2), C.shirt);
  const shTop = add(j.sh, j.up, 0.6);
  px.line(shift(shTop, -1), shift(shTop, 2), C.shirt);
  // 머리 3x3, 머리카락 한 줄, 눈
  const hc: Pt = [Math.round(j.head[0]), Math.round(j.head[1])];
  px.rect(hc[0] - 1, hc[1] - 1, 3, 3, C.skin);
  const hairDir = j.up;
  for (let i = -1; i <= 1; i++) {
    const side: Pt = [-hairDir[1], hairDir[0]];
    px.dot(hc[0] + hairDir[0] * 1 + side[0] * i, hc[1] + hairDir[1] * 1 + side[1] * i, C.hair);
  }
  px.dot(hc[0] + j.face[0] * 1, hc[1] + j.face[1] * 1 - (Math.abs(j.face[1]) < 0.5 ? 0 : 0), C.hair);
  // 앞다리 · 앞팔
  px.line(j.hip, j.knee, C.shorts);
  px.line(j.knee, j.foot, C.skin);
  footLine(j.foot, C.shoe, C.shoe2);
  px.line(j.sh, j.elbow, C.skin, 2);
  px.line(j.elbow, j.hand, C.skin);
  px.dot(j.hand[0], j.hand[1], C.skin2);
  for (const pr of props) if (pr.z === undefined || pr.z === 1) if (pr.at !== "hand2") drawProp(px, pr, j, t);
  void fd;
}

function drawFront(px: Px, p: FrontPose, props: Prop[], t: number) {
  const hx = p.hx;
  const hy = p.hy;
  const lean = p.lean ?? 0;
  const sh: Pt = [hx + lean, hy - TORSO];
  const head: Pt = [sh[0], sh[1] - 3];
  const armOf = (a: number, b: number, pin: Pt | undefined, s: number): [Pt, Pt, Pt] => {
    const s0: Pt = [sh[0] + s * 2, sh[1] + 1];
    if (pin) return [s0, ik(s0, pin, UPPER, FORE, -s), pin];
    const e: Pt = [s0[0] + s * Math.sin(a * D) * UPPER, s0[1] + Math.cos(a * D) * UPPER];
    const h: Pt = [e[0] + s * Math.sin(b * D) * FORE, e[1] + Math.cos(b * D) * FORE];
    return [s0, e, h];
  };
  const L = armOf(p.al, p.bl, p.hl, -1);
  const R = armOf(p.ar, p.br, p.hr, 1);
  const j = { hand: R[2], hand2: L[2], elbow: R[1], elbow2: L[1], sh, head, hip: [hx, hy] as Pt } as unknown as Joints;
  for (const pr of props) if (pr.z === -1) drawProp(px, pr, j, t);
  // 다리
  const spread = p.spread ?? 1;
  if (p.sit) {
    px.rect(hx - 3, hy - 1, 2, 3, C.shorts);
    px.rect(hx + 2, hy - 1, 2, 3, C.shorts);
    px.rect(hx - 4, hy + 2, 2, 2, C.shoe);
    px.rect(hx + 3, hy + 2, 2, 2, C.shoe);
  } else {
    for (const s of [-1, 1]) {
      const kx = hx + s * (1 + spread * 0.5);
      const fx = hx + s * (1 + spread);
      px.line([hx + s, hy], [kx, hy + THIGH], C.shorts);
      px.line([kx, hy + THIGH], [fx, G - 1], C.skin);
      px.rect(fx - (s < 0 ? 1 : 0), G - 1, 2, 1, C.shoe);
    }
  }
  // 몸통: 허리 3칸에서 어깨 5칸으로 넓어지는 역삼각 (빵빵한 상체)
  px.rect(Math.round(hx) - 1, Math.round(hy) - 1, 3, 2, C.shorts);
  for (let y = 0; y <= TORSO - 2; y++) {
    const yy = Math.round(hy) - 2 - y;
    const w = y < 2 ? 3 : y < 3 ? 4 : 5;
    const x0 = Math.round(hx + (lean * y) / (TORSO - 2)) - Math.floor(w / 2);
    px.rect(x0, yy, w, 1, C.shirt);
    px.dot(x0, yy, C.shirt2);
  }
  // 머리
  const hc: Pt = [Math.round(head[0]), Math.round(head[1])];
  px.rect(hc[0] - 1, hc[1] - 1, 3, 3, C.skin);
  px.rect(hc[0] - 1, hc[1] - 1, 3, 1, C.hair);
  px.dot(hc[0] - 1, hc[1], C.hair);
  px.dot(hc[0] + 1, hc[1], C.hair);
  // 팔
  for (const [s0, e, h] of [L, R]) {
    px.line(s0, e, C.skin, 2);
    px.line(e, h, C.skin);
    px.dot(h[0], h[1], C.skin2);
  }
  for (const pr of props) if (pr.z === undefined || pr.z === 1) drawProp(px, pr, j, t);
}

function drawProp(px: Px, pr: Prop, j: Joints, t: number, dim = false) {
  const at = (pr.at as string | undefined) ?? "hand";
  const base: Pt = at === "hand2" ? j.hand2 : at === "hip" ? j.hip : at === "foot" ? j.foot : at === "foot2" ? j.foot2 : at === "head" ? j.head : at === "back" ? add(j.sh, j.up, 1) : j.hand;
  const pos: Pt = [base[0] + ((pr.dx as number) ?? 0), base[1] + ((pr.dy as number) ?? 0)];
  const plate = dim ? C.plate : C.plate;
  switch (pr.k) {
    case "plate": {
      // 원판 (옆에서 본 바벨): 가운데 봉 점
      const r = (pr.r as number) ?? 2;
      const x = Math.round(pos[0]);
      const y = Math.round(pos[1]);
      for (let i = -r; i <= r; i++) for (let k = -r; k <= r; k++) if (Math.abs(i) + Math.abs(k) <= r + Math.floor(r / 2)) px.dot(x + i, y + k, plate);
      for (let i = -r; i <= r; i++) if (Math.abs(i) < r) px.dot(x + i, y - r + (Math.abs(i) === r - 1 ? 1 : 0), C.plateHi);
      px.dot(x, y, C.bar);
      break;
    }
    case "dumbbell": {
      // 덤벨: 짧은 손잡이와 양쪽 추 (옆에서는 2x3 추 둘이 겹쳐 보여 3x3)
      const x = Math.round(pos[0]);
      const y = Math.round(pos[1]);
      const v = pr.v as boolean | undefined;
      if (v) {
        px.rect(x - 1, y - 2, 3, 1, C.db);
        px.rect(x - 1, y + 1, 3, 1, C.db);
        px.dot(x, y - 1, C.bar);
        px.dot(x, y, C.bar);
      } else {
        px.rect(x - 1, y - 1, 1, 3, C.db);
        px.rect(x + 1, y - 1, 1, 3, C.db);
        px.dot(x, y, C.bar);
      }
      break;
    }
    case "kb": {
      const x = Math.round(pos[0]);
      const y = Math.round(pos[1]);
      px.rect(x - 1, y + 1, 3, 3, C.plate);
      px.dot(x, y + 1, C.plateHi);
      px.dot(x - 1, y, C.bar);
      px.dot(x + 1, y, C.bar);
      break;
    }
    case "handle": {
      // 짧은 손잡이 (가로 막대)
      const x = Math.round(pos[0]);
      const y = Math.round(pos[1]);
      const w = (pr.w as number) ?? 3;
      px.rect(x - Math.floor(w / 2), y, w, 1, C.bar);
      if (pr.v) px.rect(x, y - 1, 1, 3, C.bar);
      break;
    }
    case "bench": {
      const x = pr.x as number;
      const y = pr.y as number;
      const w = pr.w as number;
      px.rect(x, y, w, 2, C.bench);
      px.rect(x, y, w, 1, C.benchHi);
      px.rect(x + 1, y + 2, 1, G - y - 2, C.frame);
      px.rect(x + w - 2, y + 2, 1, G - y - 2, C.frame);
      break;
    }
    case "incline": {
      // 기울인 벤치: 등받이 선 + 앉는 자리
      const x = pr.x as number;
      const y = pr.y as number;
      px.rect(x, y, 5, 2, C.bench);
      px.line([x + 4, y], [x + 11, y - 9], C.bench, 2);
      px.rect(x + 1, y + 2, 1, G - y - 2, C.frame);
      px.rect(x + 5, y + 2, 1, G - y - 2, C.frame);
      break;
    }
    case "seat": {
      // 머신 의자: 앉는 자리와 등받이, 기둥
      const x = pr.x as number;
      const y = pr.y as number;
      px.rect(x, y, 6, 2, C.bench);
      px.rect(x, y, 6, 1, C.benchHi);
      if (pr.back !== false) px.rect(x - 1, y - 8, 2, 8, C.bench);
      px.rect(x + 2, y + 2, 2, G - y - 2, C.frame);
      break;
    }
    case "box": {
      px.rect(pr.x as number, pr.y as number, pr.w as number, pr.h as number, (pr.c as string) ?? C.frame);
      break;
    }
    case "post": {
      px.rect(pr.x as number, pr.y as number, 1, G - (pr.y as number), C.frame);
      break;
    }
    case "cable": {
      const from = pr.from as Pt;
      px.line(from, pos, C.cable);
      px.rect(from[0] - 1, from[1], 3, 1, C.frame);
      break;
    }
    case "bar": {
      // 철봉: 가로 봉과 기둥
      const y = pr.y as number;
      px.rect(pr.x1 as number, y, (pr.x2 as number) - (pr.x1 as number), 1, C.bar);
      px.rect(pr.x1 as number, y, 1, G - y, C.frame);
      px.rect((pr.x2 as number) - 1, y, 1, G - y, C.frame);
      break;
    }
    case "dipbars": {
      const y = pr.y as number;
      for (const x of [pr.x1 as number, pr.x2 as number]) {
        px.rect(x - 1, y, 3, 1, C.bar);
        px.rect(x, y, 1, G - y, C.frame);
      }
      break;
    }
    case "mat": {
      px.rect(pr.x as number, G - 1, pr.w as number, 1, C.shorts);
      break;
    }
    case "pad": {
      // 발목·정강이 패드 (레그 익스텐션·컬)
      const x = Math.round(pos[0]);
      const y = Math.round(pos[1]);
      px.rect(x - 1, y - 1, 3, 2, C.bench);
      break;
    }
    case "sled": {
      // 레그 프레스 발판: 발에 수직인 두꺼운 판
      const x = Math.round(pos[0]);
      const y = Math.round(pos[1]);
      px.line([x - 1, y + 3], [x + 3, y - 3], C.plate, 2);
      break;
    }
    case "rope": {
      // 줄넘기: 손 둘레 큰 원, 도는 자리에 밝은 점
      const cx = pr.cx as number;
      const cy = pr.cy as number;
      const r = pr.r as number;
      const n = 40;
      const a0 = t * Math.PI * 2;
      for (let i = 0; i < n; i += 2) {
        const a = (i / n) * Math.PI * 2;
        px.dot(cx + r * Math.sin(a), cy + r * Math.cos(a), C.rope);
      }
      for (let i = 0; i < 5; i++) {
        const a = a0 + i * 0.12;
        px.dot(cx + r * Math.sin(a), cy + r * Math.cos(a), C.gold);
      }
      break;
    }
    case "treadmill": {
      // 벨트 (줄무늬가 뒤로 흐름) 와 손잡이 기둥
      const x = pr.x as number;
      const w = pr.w as number;
      px.rect(x, G, w, 2, C.belt);
      const o = Math.floor(t * 4) % 4;
      for (let i = x + o; i < x + w; i += 4) px.dot(i, G, C.beltHi);
      px.rect(x + w - 2, G - 14, 1, 14, C.frame);
      px.rect(x + w - 4, G - 15, 4, 2, C.plate);
      px.dot(x + w - 3, G - 15, C.gold);
      break;
    }
    case "bike": {
      // 바퀴·페달·안장·핸들
      const cx = pr.cx as number;
      const cy = pr.cy as number;
      px.circle(cx + 3, cy, 3.5, C.frame);
      px.rect(cx - 7, cy - 1, 1, 5, C.frame);
      px.line([cx, cy], [cx - 6, cy - 9], C.frame);
      px.rect(cx - 8, cy - 10, 4, 1, C.bench);
      px.line([cx, cy], [cx + 8, cy - 10], C.frame);
      px.rect(cx + 7, cy - 11, 3, 1, C.bar);
      px.dot(cx, cy, C.bar);
      break;
    }
    case "rower": {
      // 레일·발판·바퀴
      const y = pr.y as number;
      px.rect(2, y, 26, 1, C.frame);
      px.rect(4, y + 1, 1, G - y - 1, C.frame);
      px.rect(26, y + 1, 1, G - y - 1, C.frame);
      px.line([22, y - 1], [24, y - 5], C.plate, 2);
      px.circle(29, y - 4, 2.5, C.plate);
      px.rect(Math.round(j.hip[0]) - 2, y - 1, 4, 1, C.bench);
      break;
    }
    case "stairs": {
      // 내려오는 계단 (발판 셋)
      const x = pr.x as number;
      const h = 4;
      for (let i = -1; i < 3; i++) {
        const yy = G - 10 + ((i + t) % 3) * h;
        const yr = Math.round(yy);
        if (yr > G - 1) continue;
        px.rect(x, yr, 5, 1, C.beltHi);
        px.rect(x + 5, yr, 1, Math.min(h, G - yr), C.frame);
      }
      px.rect(x + 6, G - 10, 1, 10, C.frame);
      px.line([x + 6, G - 16], [x + 10, G - 10], C.frame);
      px.line([x - 4, G - 4], [x + 2, G - 12], C.bar);
      break;
    }
    case "elliptical": {
      const x = pr.x as number;
      px.rect(x - 8, G - 1, 20, 2, C.belt);
      px.rect(x + 7, G - 16, 1, 15, C.frame);
      px.rect(x + 5, G - 17, 5, 1, C.plate);
      px.line(j.foot, [j.foot[0] + 2, j.foot[1]], C.plate);
      px.line(j.foot2, [j.foot2[0] + 2, j.foot2[1]], C.plate);
      break;
    }
    case "block": {
      // 발밑 받침 (카프 레이즈)
      px.rect(pr.x as number, G - 2, pr.w as number, 2, C.frame);
      break;
    }
    case "ball": {
      const x = Math.round(pos[0]);
      const y = Math.round(pos[1]);
      px.rect(x - 1, y - 1, 3, 3, C.plate);
      px.dot(x - 1, y - 1, C.plateHi);
      break;
    }
    case "sweat": {
      // 땀방울 (플랭크)
      const ph = (t * 2) % 1;
      const x = Math.round(j.head[0]) + 1;
      px.dot(x, Math.round(j.head[1]) - 2 + ph * 3, "#8fd3ff");
      break;
    }
  }
}

/* ───────── 자세 보간 ───────── */
function isFront(p: AnyPose): p is FrontPose {
  return (p as FrontPose).front === true;
}
function mix(a: AnyPose, b: AnyPose, t: number): AnyPose {
  const out: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  for (const k of keys) {
    const va = ra[k];
    const vb = rb[k];
    if (typeof va === "number" && typeof vb === "number") out[k] = lerp(va, vb, t);
    else if (Array.isArray(va) && Array.isArray(vb)) out[k] = [lerp(va[0], vb[0], t), lerp(va[1], vb[1], t)];
    else out[k] = t < 0.5 ? (va ?? vb) : (vb ?? va);
  }
  return out as unknown as AnyPose;
}
function poseAt(an: Anim, p: number): AnyPose {
  if (an.pose) return an.pose(p);
  const fr = an.frames ?? [];
  if (fr.length === 1) return fr[0];
  const n = fr.length;
  const x = p * n;
  const i = Math.floor(x) % n;
  const u = ease(x - Math.floor(x));
  return mix(fr[i], fr[(i + 1) % n], u);
}

/** 캔버스에 그 종목의 때 t(ms) 장면을 그린다 */
export function drawAnim(ctx: CanvasRenderingContext2D, key: string, ms: number) {
  const an = ANIMS[key] ?? ANIMS.walk;
  const p = ((ms % an.dur) + an.dur) % an.dur / an.dur;
  ctx.clearRect(0, 0, AW, AH);
  const px = new Px(ctx);
  // 바닥
  px.rect(0, G, AW, 1, C.floor);
  px.rect(0, G + 1, AW, 1, C.floor2);
  const pose = poseAt(an, p);
  const props = an.props ?? [];
  if (isFront(pose)) drawFront(px, pose, props, p);
  else drawSide(px, pose, joints(pose), props, p);
}

/* ───────── 종목 동작 ───────── */
const S = (hx: number, hy: number, to: number, rest: Partial<Pose> = {}): Pose => ({ hx, hy, to, ...rest });
/** 서 있는 기본 (엉덩이 14, 발 24) */
const STAND = (rest: Partial<Pose> = {}): Pose => S(14, 14, 0, { th: 0, sh: 0, th2: -6, sh2: -6, ua: 0, fa: 0, ...rest });
/** 앉은 기본 (엉덩이 19, 무릎 앞, 발 24) */
const SIT = (hx: number, rest: Partial<Pose> = {}): Pose => S(hx, 19, 0, { th: 90, sh: 0, ...rest });
/** 벤치에 누움 (머리 오른쪽, 위를 봄) */
const LIE = (hx: number, rest: Partial<Pose> = {}): Pose => S(hx, 15, 90, { fd: -1, th: -45, sh: -11, ...rest });
const FLOOR_LIE = (hx: number, rest: Partial<Pose> = {}): Pose => S(hx, 22, 90, { fd: -1, ...rest });
const F = (al: number, bl: number, ar: number, br: number, rest: Partial<FrontPose> = {}): FrontPose => ({ front: true, hx: 16, hy: 14, al, bl, ar, br, ...rest });

/** 달리기·걷기 한 걸음 (p 0~1): 다리 두 개가 반 바퀴씩 어긋난다 */
function gait(p: number, run: boolean): Pose {
  const leg = (q: number): [number, number] => {
    const a = q * Math.PI * 2;
    const th = (run ? 42 : 28) * Math.sin(a);
    // 뒤로 갈 때 정강이가 접힌다
    const fold = Math.max(0, -Math.sin(a + 0.9)) * (run ? 95 : 55);
    return [th, th - fold];
  };
  const [th, sh] = leg(p);
  const [th2, sh2] = leg(p + 0.5);
  const bob = run ? Math.abs(Math.sin(p * Math.PI * 2)) * 1.2 : Math.abs(Math.sin(p * Math.PI * 2)) * 0.5;
  const swing = (run ? 40 : 24) * Math.sin(p * Math.PI * 2);
  return S(14, 14 - bob, run ? 8 : 2, { th, sh, th2, sh2, ua: -swing, fa: -swing + (run ? 90 : 35), ua2: swing, fa2: swing + (run ? 90 : 35) });
}

const ANIMS: Record<string, Anim> = {
  /* 가슴 */
  bench: {
    dur: 1700,
    frames: [LIE(11, { ua: 180, fa: 180 }), LIE(11, { ua: -110, fa: 165 })],
    props: [{ k: "bench", x: 5, y: 16, w: 20, z: -1 }, { k: "plate", r: 2 }],
  },
  incline_bench: {
    dur: 1700,
    frames: [S(12, 16, 45, { fd: -1, th: -55, sh: -5, ua: 135, fa: 135 }), S(12, 16, 45, { fd: -1, th: -55, sh: -5, ua: -150, fa: 120 })],
    props: [{ k: "incline", x: 9, y: 17, z: -1 }, { k: "plate", r: 2 }],
  },
  db_bench: {
    dur: 1700,
    frames: [LIE(11, { ua: 180, fa: 180 }), LIE(11, { ua: -115, fa: 165 })],
    props: [{ k: "bench", x: 5, y: 16, w: 20, z: -1 }, { k: "dumbbell" }, { k: "dumbbell", at: "hand2" }],
  },
  incline_db: {
    dur: 1700,
    frames: [S(12, 16, 45, { fd: -1, th: -55, sh: -5, ua: 135, fa: 135 }), S(12, 16, 45, { fd: -1, th: -55, sh: -5, ua: -150, fa: 120 })],
    props: [{ k: "incline", x: 9, y: 17, z: -1 }, { k: "dumbbell" }, { k: "dumbbell", at: "hand2" }],
  },
  db_fly: {
    dur: 2000,
    frames: [LIE(11, { ua: 175, fa: 175, ua2: 175, fa2: 175 }), LIE(11, { ua: -115, fa: -100, ua2: 110, fa2: 95 })],
    props: [{ k: "bench", x: 5, y: 16, w: 20, z: -1 }, { k: "dumbbell" }, { k: "dumbbell", at: "hand2" }],
  },
  cable_cross: {
    dur: 1900,
    frames: [F(100, 95, 100, 95), F(30, 60, 30, 60)],
    props: [{ k: "cable", from: [2, 1], at: "hand2", z: -1 }, { k: "cable", from: [30, 1], z: -1 }],
  },
  chest_press: {
    dur: 1600,
    frames: [SIT(11, { ua: -85, fa: 90 }), SIT(11, { ua: 80, fa: 95 })],
    props: [{ k: "seat", x: 9, y: 20, z: -1 }, { k: "handle", v: true }, { k: "box", x: 24, y: 6, w: 3, h: 18, c: C.frame, z: -1 }],
  },
  pec_deck: {
    dur: 1800,
    frames: [F(95, 180, 95, 180, { sit: true, hy: 19 }), F(35, 180, 35, 180, { sit: true, hy: 19 })],
    props: [{ k: "box", x: 14, y: 20, w: 5, h: 4, c: C.bench, z: -1 }],
  },
  pushup: {
    dur: 1500,
    frames: [S(12, 17, 75, { th: -60, sh: -55, ua: 5, fa: 5, arm2: false, leg2: false }), S(12, 20, 80, { th: -70, sh: -60, ua: -60, fa: 40, arm2: false, leg2: false })],
    props: [{ k: "mat", x: 1, w: 24 }],
  },
  dips: {
    dur: 1600,
    frames: [S(14, 14, 5, { th: -10, sh: -100, hand: [14, 16] }), S(14, 17, 10, { th: -10, sh: -100, hand: [14, 16] })],
    props: [{ k: "dipbars", x1: 11, x2: 17, y: 16, z: -1 }],
  },
  /* 등 */
  deadlift: {
    dur: 2000,
    frames: [S(12, 16, 55, { th: 40, sh: 11, ua: 0, fa: 0 }), STAND({ th: 0, sh: 0, th2: -4, sh2: -4 })],
    props: [{ k: "plate", r: 2 }],
  },
  lat_pulldown: {
    dur: 1700,
    frames: [SIT(12, { to: -8, ua: 160, fa: 170 }), SIT(12, { to: -12, ua: -25, fa: 150 })],
    props: [{ k: "seat", x: 10, y: 20, back: false, z: -1 }, { k: "cable", from: [15, 0] }, { k: "handle", w: 5 }],
  },
  barbell_row: {
    dur: 1500,
    frames: [S(12, 15, 70, { th: 15, sh: 15, ua: 0, fa: 0 }), S(12, 15, 70, { th: 15, sh: 15, ua: -70, fa: 60 })],
    props: [{ k: "plate", r: 2 }],
  },
  db_row: {
    dur: 1500,
    frames: [S(10, 15, 80, { th: -20, sh: 0, th2: 20, sh2: -90, ua: 0, fa: 0, ua2: 35, fa2: 35 }), S(10, 15, 80, { th: -20, sh: 0, th2: 20, sh2: -90, ua: -60, fa: 50, ua2: 35, fa2: 35 })],
    props: [{ k: "bench", x: 6, y: 21, w: 18, z: -1 }, { k: "dumbbell" }],
  },
  cable_row: {
    dur: 1700,
    frames: [S(10, 19, 15, { th: 75, sh: 70, ua: 90, fa: 90 }), S(10, 19, -12, { th: 75, sh: 70, ua: -60, fa: 80 })],
    props: [{ k: "seat", x: 8, y: 20, back: false, z: -1 }, { k: "box", x: 19, y: 18, w: 1, h: 6, c: C.plate, z: -1 }, { k: "cable", from: [31, 12] }, { k: "handle", v: true }],
  },
  tbar_row: {
    dur: 1500,
    frames: [S(12, 15, 70, { th: 15, sh: 15, ua: 0, fa: 0 }), S(12, 15, 70, { th: 15, sh: 15, ua: -70, fa: 60 })],
    props: [{ k: "cable", from: [2, 24], z: -1 }, { k: "plate", r: 2 }],
  },
  pullup: {
    dur: 1800,
    frames: [S(14, 16, 0, { th: 5, sh: -90, hand: [14, 2], el: 1 }), S(14, 10, 3, { th: 5, sh: -90, hand: [14, 2], el: 1 })],
    props: [{ k: "bar", x1: 7, x2: 22, y: 2, z: -1 }],
  },
  back_ext: {
    dur: 1800,
    frames: [S(14, 12, 150, { th: -90, sh: -90, fd: 1, ua: 20, fa: 20, leg2: false }), S(14, 12, 85, { th: -90, sh: -90, fd: 1, ua: 60, fa: 60, leg2: false })],
    props: [{ k: "box", x: 8, y: 13, w: 6, h: 11, c: C.bench, z: -1 }, { k: "box", x: 2, y: 14, w: 3, h: 10, c: C.frame, z: -1 }],
  },
  /* 하체 */
  squat: {
    dur: 1800,
    frames: [STAND({ ua: -120, fa: 74 }), S(10, 18, 35, { th: 75, sh: -4, th2: 70, sh2: -4, ua: -120, fa: 74 })],
    props: [{ k: "plate", r: 2, at: "back", dx: -2, z: 0 }],
  },
  leg_press: {
    dur: 1600,
    frames: [S(14, 17, -50, { fd: 1, th: 70, sh: 200, ua: -20, fa: 60 }), S(14, 17, -50, { fd: 1, th: 130, sh: 130, ua: -20, fa: 60 })],
    props: [{ k: "seat", x: 11, y: 18, back: false, z: -1 }, { k: "sled", at: "foot" }],
  },
  lunge: {
    dur: 1800,
    frames: [STAND(), S(12, 17, 5, { th: 70, sh: 0, th2: -30, sh2: -80 }), STAND()],
    props: [{ k: "dumbbell" }, { k: "dumbbell", at: "hand2" }],
  },
  bss: {
    dur: 1700,
    frames: [S(12, 15, 5, { th: 55, sh: -5, th2: -20, sh2: -110 }), S(12, 18, 10, { th: 75, sh: -5, th2: -40, sh2: -110 })],
    props: [{ k: "bench", x: 1, y: 17, w: 7, z: -1 }, { k: "dumbbell" }, { k: "dumbbell", at: "hand2" }],
  },
  leg_ext: {
    dur: 1600,
    frames: [SIT(11, { th: 90, sh: 0, ua: 10, fa: 10 }), SIT(11, { th: 90, sh: 90, ua: 10, fa: 10 })],
    props: [{ k: "seat", x: 9, y: 20, z: -1 }, { k: "pad", at: "foot" }],
  },
  leg_curl: {
    dur: 1600,
    frames: [S(14, 15, 90, { fd: 1, th: -90, sh: -90, ua: 60, fa: 30, leg2: false }), S(14, 15, 90, { fd: 1, th: -90, sh: -180, ua: 60, fa: 30, leg2: false })],
    props: [{ k: "bench", x: 6, y: 17, w: 20, z: -1 }, { k: "pad", at: "foot" }],
  },
  rdl: {
    dur: 1900,
    frames: [STAND({ th: 0, sh: 0, th2: -4, sh2: -4 }), S(11, 15, 75, { th: 12, sh: 12, ua: 0, fa: 0 })],
    props: [{ k: "plate", r: 2 }],
  },
  hip_thrust: {
    dur: 1600,
    frames: [S(13, 20, 50, { fd: -1, foot: [9, 24], kn: 1, ua: 20, fa: 20, leg2: false }), S(13, 14, 80, { fd: -1, foot: [9, 24], kn: 1, ua: 60, fa: 60, leg2: false })],
    props: [{ k: "bench", x: 18, y: 15, w: 9, z: -1 }, { k: "plate", r: 2, at: "hip", dy: -2 }],
  },
  calf_raise: {
    dur: 1400,
    frames: [STAND({ heel: 0 }), S(14, 12, 0, { th: 0, sh: 0, th2: -6, sh2: -6, heel: 1 })],
    props: [{ k: "dumbbell" }, { k: "dumbbell", at: "hand2" }],
  },
  /* 어깨 */
  ohp: {
    dur: 1600,
    frames: [STAND({ ua: 30, fa: 180 }), STAND({ ua: 160, fa: 175 })],
    props: [{ k: "plate", r: 1 }],
  },
  db_shoulder: {
    dur: 1600,
    frames: [SIT(12, { ua: 10, fa: 175 }), SIT(12, { ua: 160, fa: 175 })],
    props: [{ k: "seat", x: 10, y: 20, z: -1 }, { k: "dumbbell" }, { k: "dumbbell", at: "hand2" }],
  },
  lateral_raise: {
    dur: 1700,
    frames: [F(8, 8, 8, 8), F(88, 88, 88, 88)],
    props: [{ k: "dumbbell", v: true }, { k: "dumbbell", at: "hand2", v: true }],
  },
  front_raise: {
    dur: 1700,
    frames: [STAND({ ua: 10, fa: 10 }), STAND({ ua: 95, fa: 95 })],
    props: [{ k: "dumbbell" }, { k: "dumbbell", at: "hand2" }],
  },
  rear_delt: {
    dur: 1600,
    frames: [S(12, 15, 70, { th: 15, sh: 15, ua: 10, fa: 10 }), S(12, 15, 70, { th: 15, sh: 15, ua: -75, fa: -75 })],
    props: [{ k: "dumbbell" }, { k: "dumbbell", at: "hand2" }],
  },
  face_pull: {
    dur: 1600,
    frames: [STAND({ ua: 85, fa: 85 }), STAND({ ua: -80, fa: 100 })],
    props: [{ k: "cable", from: [31, 6] }, { k: "handle", v: true }],
  },
  upright_row: {
    dur: 1500,
    frames: [STAND({ ua: 0, fa: 0 }), STAND({ ua: -100, fa: 90 })],
    props: [{ k: "plate", r: 1 }],
  },
  /* 팔 */
  barbell_curl: {
    dur: 1500,
    frames: [STAND({ ua: 5, fa: 5 }), STAND({ ua: 5, fa: 150 })],
    props: [{ k: "plate", r: 1 }],
  },
  db_curl: {
    dur: 1500,
    frames: [STAND({ ua: 5, fa: 5, ua2: 5, fa2: 5 }), STAND({ ua: 5, fa: 150, ua2: 5, fa2: 150 })],
    props: [{ k: "dumbbell" }, { k: "dumbbell", at: "hand2" }],
  },
  hammer_curl: {
    dur: 1600,
    frames: [STAND({ ua: 5, fa: 5, ua2: 5, fa2: 150 }), STAND({ ua: 5, fa: 150, ua2: 5, fa2: 5 })],
    props: [{ k: "dumbbell", v: true }, { k: "dumbbell", at: "hand2", v: true }],
  },
  pushdown: {
    dur: 1400,
    frames: [STAND({ to: 8, ua: 20, fa: 150 }), STAND({ to: 8, ua: 20, fa: 15 })],
    props: [{ k: "cable", from: [21, 0] }, { k: "handle", w: 3 }],
  },
  skull_crusher: {
    dur: 1600,
    frames: [LIE(11, { ua: 180, fa: 180 }), LIE(11, { ua: 180, fa: 115 })],
    props: [{ k: "bench", x: 5, y: 16, w: 20, z: -1 }, { k: "plate", r: 1 }],
  },
  oh_tricep: {
    dur: 1600,
    frames: [STAND({ ua: 175, fa: 175 }), STAND({ ua: 175, fa: -100 })],
    props: [{ k: "dumbbell" }],
  },
  /* 복근 */
  crunch: {
    dur: 1600,
    frames: [FLOOR_LIE(11, { th: -149, sh: -31, ua: 146, fa: 40, leg2: false }), S(11, 22, 60, { fd: -1, th: -149, sh: -31, ua: 116, fa: 10, leg2: false })],
    props: [{ k: "mat", x: 2, w: 24 }],
  },
  leg_raise: {
    dur: 1800,
    frames: [FLOOR_LIE(10, { th: -90, sh: -90, ua: -80, fa: -80, leg2: false }), FLOOR_LIE(10, { th: -170, sh: -170, ua: -80, fa: -80, leg2: false })],
    props: [{ k: "mat", x: 2, w: 24 }],
  },
  hanging_raise: {
    dur: 1800,
    frames: [S(14, 14, 0, { th: 0, sh: 0, hand: [14, 0], el: 1 }), S(14, 14, -8, { th: 90, sh: 90, hand: [14, 0], el: 1 })],
    props: [{ k: "bar", x1: 7, x2: 22, y: 0, z: -1 }],
  },
  russian_twist: {
    dur: 1400,
    frames: [F(0, 0, 0, 0, { sit: true, hy: 19, hl: [9, 11], hr: [9, 11], lean: -1 }), F(0, 0, 0, 0, { sit: true, hy: 19, hl: [23, 11], hr: [23, 11], lean: 1 })],
    props: [{ k: "ball" }, { k: "mat", x: 6, w: 20 }],
  },
  cable_crunch: {
    dur: 1600,
    frames: [S(12, 19, 10, { th: 0, sh: -90, ua: 120, hand: [15, 9], el: -1 }), S(12, 19, 60, { th: 0, sh: -90, ua: 120, hand: [20, 13], el: -1 })],
    props: [{ k: "cable", from: [23, 0] }, { k: "handle", w: 2 }, { k: "mat", x: 3, w: 16 }],
  },
  plank: {
    dur: 2400,
    frames: [S(12, 19, 78, { th: -70, sh: -60, ua: -13, fa: 90, arm2: false, leg2: false }), S(12, 19.6, 78, { th: -70, sh: -60, ua: -13, fa: 90, arm2: false, leg2: false })],
    props: [{ k: "mat", x: 1, w: 24 }, { k: "sweat" }],
  },
  /* 유산소 */
  treadmill: {
    dur: 700,
    pose: (p) => {
      const g = gait(p, true);
      return { ...g, hx: 12 };
    },
    props: [{ k: "treadmill", x: 3, w: 24, z: -1 }],
  },
  cycle: {
    dur: 1000,
    pose: (p) => {
      const a = p * Math.PI * 2;
      const c: Pt = [16, 19];
      const r = 2.5;
      const f1: Pt = [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
      const f2: Pt = [c[0] - r * Math.cos(a), c[1] - r * Math.sin(a)];
      return S(11, 14, 40, { foot: f1, foot2: f2, kn: -1, hand: [22, 10], hand2: [22, 10], el: 1 });
    },
    props: [{ k: "bike", cx: 16, cy: 19, z: -1 }],
  },
  stair: {
    dur: 1400,
    pose: (p) => {
      const step = (q: number): Pt => {
        const u = q % 1;
        // 발판에 실려 내려가다(0~0.7) 위로 올라탄다(0.7~1)
        if (u < 0.7) return [16, 14 + (u / 0.7) * 8];
        const v = (u - 0.7) / 0.3;
        return [16 - Math.sin(v * Math.PI) * 2, 22 - v * 8 - Math.sin(v * Math.PI) * 2];
      };
      return S(11, 13 + Math.sin(p * Math.PI * 4) * 0.5, 15, { foot: step(p), foot2: step(p + 0.5), kn: -1, hand: [21, 9], hand2: [21, 9], el: 1 });
    },
    props: [{ k: "stairs", x: 14, z: -1 }],
  },
  rowing: {
    dur: 1900,
    pose: (p) => {
      // 0~0.45 당기기, 0.45~1 돌아가기
      const u = p < 0.45 ? ease(p / 0.45) : 1 - ease((p - 0.45) / 0.55);
      const hx = lerp(9, 15, u);
      return S(hx, 20, lerp(28, -15, u), { foot: [23, 21], foot2: [23, 21], kn: -1, hand: [lerp(20, 11, u), lerp(17, 15, u)], hand2: [lerp(20, 11, u), lerp(17, 15, u)], el: 1 });
    },
    props: [{ k: "rower", y: 22, z: -1 }, { k: "cable", from: [29, 18] }, { k: "handle", v: true }],
  },
  elliptical: {
    dur: 1300,
    pose: (p) => {
      const a = p * Math.PI * 2;
      const f1: Pt = [15 + 4 * Math.cos(a), 22 - 1.5 * Math.sin(a)];
      const f2: Pt = [15 - 4 * Math.cos(a), 22 + 1.5 * Math.sin(a)];
      return S(13, 13 - Math.abs(Math.sin(a)) * 0.6, 5, { foot: f1, foot2: f2, kn: -1, hand: [19 - 2 * Math.cos(a), 10], hand2: [19 + 2 * Math.cos(a), 10], el: 1 });
    },
    props: [{ k: "elliptical", x: 14, z: -1 }],
  },
  walk: {
    dur: 1100,
    pose: (p) => gait(p, false),
  },
  jump_rope: {
    dur: 600,
    pose: (p) => {
      const jump = Math.max(0, Math.sin(p * Math.PI * 2 + Math.PI)) * 2.2;
      return S(14, 14 - jump, 2, { th: 0, sh: jump > 0.6 ? -25 : 0, th2: -4, sh2: jump > 0.6 ? -25 : -4, ua: 25, fa: 100, ua2: 25, fa2: 100, heel: Math.min(1, jump) });
    },
    props: [{ k: "rope", cx: 15, cy: 13, r: 10.5, z: -1 }],
  },
  /* 기타 */
  burpee: {
    dur: 3000,
    frames: [
      STAND(),
      S(11, 18, 50, { th: 80, sh: -5, hand: [17, 24], hand2: [17, 24], el: 1 }),
      S(12, 20, 80, { th: -70, sh: -60, ua: 5, fa: 5, arm2: false, leg2: false }),
      S(11, 18, 50, { th: 80, sh: -5, hand: [17, 24], hand2: [17, 24], el: 1 }),
      S(14, 11, 0, { th: 5, sh: -20, th2: -2, sh2: -20, ua: 175, fa: 175 }),
      STAND(),
    ],
    props: [{ k: "mat", x: 2, w: 24 }],
  },
  kb_swing: {
    dur: 1500,
    frames: [S(12, 15, 65, { th: 30, sh: 20, ua: -25, fa: -25 }), STAND({ ua: 90, fa: 90 })],
    props: [{ k: "kb" }],
  },
  stretch: {
    dur: 3200,
    frames: [STAND({ ua: 175, fa: 175 }), S(13, 14, 120, { th: 3, sh: 3, th2: -3, sh2: -3, ua: 10, fa: 10 }), S(13, 14, 125, { th: 3, sh: 3, th2: -3, sh2: -3, ua: 15, fa: 15 }), STAND({ ua: 175, fa: 175 })],
  },
};

/** 그 종목의 동작 키 (기본 종목은 그대로, 내 종목은 부위·기록 방법으로 비슷한 동작) */
export function animKeyOf(ex: Pick<Exercise, "key" | "part" | "kind">): string {
  if (ANIMS[ex.key]) return ex.key;
  const kind: Kind = ex.kind;
  if (kind === "cardio") return ex.part === "etc" ? "stretch" : "treadmill";
  if (kind === "time") return "plank";
  const byPart: Record<Part, string> = { chest: "bench", back: "lat_pulldown", legs: "squat", shoulder: "ohp", arm: "db_curl", abs: "crunch", cardio: "treadmill", etc: kind === "reps" ? "burpee" : "kb_swing" };
  return byPart[ex.part] ?? "walk";
}

export const ANIM_KEYS = Object.keys(ANIMS);
export const animDur = (key: string) => (ANIMS[key] ?? ANIMS.walk).dur;
