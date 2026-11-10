// 캐릭터 사진 AI 보정의 그림 계산 (AvatarMaker.tsx 가 쓰고, 시험 scripts/avatar-review-test.mjs 도 같은 코드를 쓴다). DOM 없이 픽셀만 다룬다
/** 픽셀 묶음 (ImageData 와 같은 모양) */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** AI 검수가 찍은 점 (그림 칸 번호) */
export interface Marks {
  keep: number[];
  remove: number[];
  /** remove 점마다 그 물체를 감싸는 네모 [x0, y0, x1, y1] (그림 칸 좌표). 지우는 범위는 이 네모 안까지만 */
  boxes: number[][];
}

/**
 * AI 는 이름표, 펫처럼 떨어져 있는 것도 남긴다 (제작자가 본 결과). 가장 큰 덩어리(캐릭터)와 거기 붙은 것만 남기고
 * 떨어진 조각은 지운다
 */
export function keepBiggest(a: Uint8Array, w: number, h: number): Uint8Array {
  const label = new Int32Array(a.length);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  const stack: number[] = [];
  for (let start = 0; start < a.length; start++) {
    if (!a[start] || label[start]) continue;
    next++;
    let size = 0;
    label[start] = next;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (a[j] && !label[j]) {
            label[j] = next;
            stack.push(j);
          }
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) if (label[i] === best) out[i] = 255;
  return out;
}

/** i 에서 가장 가까운 남은 칸 (r 칸 안). 없으면 -1 */
export function nearest(mask: Uint8Array, w: number, h: number, i: number, r: number): number {
  if (mask[i]) return i;
  const x0 = i % w;
  const y0 = (i - x0) / w;
  for (let d = 1; d <= r; d++) {
    let best = -1;
    let bestD = Infinity;
    for (let y = Math.max(0, y0 - d); y <= Math.min(h - 1, y0 + d); y++) {
      for (let x = Math.max(0, x0 - d); x <= Math.min(w - 1, x0 + d); x++) {
        const j = y * w + x;
        const dd = (x - x0) ** 2 + (y - y0) ** 2;
        if (mask[j] && dd < bestD) {
          bestD = dd;
          best = j;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * 점에서 색 경계를 따라 퍼지기 (geodesic): 남은 칸마다 가장 가깝게 닿는 점의 편이 된다. 비슷한 색끼리는 쉽게 건너고
 * 색이 확 바뀌는 곳(캐릭터의 검은 테두리와 회색 바닥 물체 사이 같은 곳)은 건너기 어렵게 해서, 캐릭터에 붙어 있어도
 * 캐릭터가 아닌 덩어리만 지운다. 지울 것이 너무 많으면(점이 잘못 찍혔다) null
 */
export function separate(src: Pixels, mask: Uint8Array, marks: Marks): Uint8Array | null {
  const { width: w, height: h, data } = src;
  const n = w * h;
  const total = mask.reduce((s, v) => s + (v ? 1 : 0), 0);
  const reach = Math.max(3, Math.round(Math.max(w, h) * 0.04));
  const keep = marks.keep.map((i) => nearest(mask, w, h, i, reach)).filter((i) => i >= 0);
  // 지울 점은 남은 칸 위(1칸 안)에 있어야 한다. 점마다 번호를 달아 그 점의 네모 안에서만 지운다
  const remove: { at: number; box: number[] }[] = [];
  marks.remove.forEach((i, j) => {
    const at = nearest(mask, w, h, i, 1);
    if (at >= 0 && remove.length < 250) remove.push({ at, box: marks.boxes[j] ?? [0, 0, w - 1, h - 1] });
  });
  if (!keep.length || !remove.length || !total) return null;

  const dist = new Int32Array(n).fill(0x7fffffff);
  const side = new Uint8Array(n);
  let hi = new Int32Array(4096);
  let hd = new Int32Array(4096);
  let size = 0;
  const push = (i: number, d: number) => {
    if (size === hi.length) {
      const a = new Int32Array(size * 2);
      a.set(hi);
      hi = a;
      const b = new Int32Array(size * 2);
      b.set(hd);
      hd = b;
    }
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hd[p] <= d) break;
      hi[k] = hi[p];
      hd[k] = hd[p];
      k = p;
    }
    hi[k] = i;
    hd[k] = d;
  };
  const seed = (i: number, s: number) => {
    dist[i] = 0;
    side[i] = s;
    push(i, 0);
  };
  remove.forEach((r, j) => seed(r.at, 2 + j));
  keep.forEach((i) => seed(i, 1)); // 같은 칸이면 남기는 쪽
  while (size) {
    const i = hi[0];
    const d = hd[0];
    const li = hi[--size];
    const ld = hd[size];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= size) break;
      if (c + 1 < size && hd[c + 1] < hd[c]) c++;
      if (hd[c] >= ld) break;
      hi[k] = hi[c];
      hd[k] = hd[c];
      k = c;
    }
    hi[k] = li;
    hd[k] = ld;
    if (d > dist[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if ((!dx && !dy) || nx < 0 || nx >= w) continue;
        const j = ny * w + nx;
        if (!mask[j]) continue;
        const diff = Math.max(Math.abs(data[i * 4] - data[j * 4]), Math.abs(data[i * 4 + 1] - data[j * 4 + 1]), Math.abs(data[i * 4 + 2] - data[j * 4 + 2]));
        const nd = d + 1 + Math.max(0, diff - 14) * 3;
        if (nd < dist[j]) {
          dist[j] = nd;
          side[j] = side[i];
          push(j, nd);
        }
      }
    }
  }
  // 네모는 조금 넓혀 본다 (Claude 가 그린 네모가 물체 끝을 살짝 못 덮어도)
  const pad = Math.max(2, Math.round(Math.max(w, h) * 0.015));
  const out = new Uint8Array(n);
  let gone = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const r = side[i] >= 2 ? remove[side[i] - 2] : null;
    const x = i % w;
    const y = (i - x) / w;
    if (r && x >= r.box[0] - pad && x <= r.box[2] + pad && y >= r.box[1] - pad && y <= r.box[3] + pad) gone++;
    else out[i] = 255;
  }
  return gone > 0 && gone <= total * 0.7 ? out : null;
}

/** 가는 찌꺼기 줄(배경 지우기가 남긴 1~2 칸 너비의 테두리 조각)을 걷어 낸다: 3x3 으로 깎았다가 다시 불린다 */
export function openMask(a: Uint8Array, w: number, h: number): Uint8Array {
  const pass = (m: Uint8Array, all: boolean) => {
    const out = new Uint8Array(m.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let hit = all;
        for (let dy = -1; dy <= 1 && hit === all; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            const v = nx >= 0 && ny >= 0 && nx < w && ny < h ? m[ny * w + nx] : 0;
            if (all ? !v : v) {
              hit = !all;
              break;
            }
          }
        }
        if (hit) out[y * w + x] = 255;
      }
    }
    return out;
  };
  const opened = pass(pass(a, true), false);
  for (let i = 0; i < a.length; i++) if (!a[i]) opened[i] = 0;
  return opened;
}

/** 가는 찌꺼기 줄 걷기. 걷히는 칸이 4% 를 넘으면(도트가 작아 캐릭터의 가는 선까지 걷힌다) 그대로 둔다 */
export function cleanThin(a: Uint8Array, w: number, h: number): Uint8Array {
  const opened = keepBiggest(openMask(a, w, h), w, h);
  let before = 0;
  let after = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i]) before++;
    if (opened[i]) after++;
  }
  return after && before - after <= before * 0.04 ? opened : a;
}

/** 배경 지우기 결과(base)에서 검수 점대로 캐릭터가 아닌 덩어리를 지우고 떨어진 조각과 가는 줄을 걷은 것. 점이 맞지 않으면 null */
export function cutWithMarks(src: Pixels, base: Uint8Array, marks: Marks): Uint8Array | null {
  const { width: w, height: h } = src;
  if (!marks.remove.length) return cleanThin(keepBiggest(base, w, h), w, h);
  const cut = separate(src, base, marks);
  return cut && cleanThin(keepBiggest(cut, w, h), w, h);
}

/** 검수에 보여 줄 그림: 남은 칸은 그대로, 지운 칸은 자홍색 (RGBA) */
export function onMagenta(src: Pixels, alpha: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(alpha.length * 4);
  for (let i = 0; i < alpha.length; i++) {
    out[i * 4] = alpha[i] ? src.data[i * 4] : 255;
    out[i * 4 + 1] = alpha[i] ? src.data[i * 4 + 1] : 0;
    out[i * 4 + 2] = alpha[i] ? src.data[i * 4 + 2] : 255;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** 검수 그림 크기: Claude 가 줄이지 않는 크기 안에서 도트가 크게 보이게 정수배로 키운다 (너무 크면 줄인다) */
export function reviewScale(w: number, h: number, max = 960): number {
  const big = Math.max(w, h);
  return big <= max ? Math.max(1, Math.floor(max / big)) : max / big;
}

/** 검수 그림 위의 점(x, y) -> 원래 그림 칸 번호 */
export function markIndex(p: { x: number; y: number }, k: number, w: number, h: number): number {
  const x = Math.min(w - 1, Math.max(0, Math.floor((p.x + 0.5) / k)));
  const y = Math.min(h - 1, Math.max(0, Math.floor((p.y + 0.5) / k)));
  return y * w + x;
}

/** 검수 그림 위의 네모 -> 원래 그림 칸 좌표의 네모 [x0, y0, x1, y1] */
export function markBox(p: { x0: number; y0: number; x1: number; y1: number }, k: number, w: number, h: number): number[] {
  const at = (v: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor((v + 0.5) / k)));
  return [at(p.x0, w), at(p.y0, h), at(p.x1, w), at(p.y1, h)];
}

/**
 * 배경 지우기 AI 가 캐릭터 안에 낸 구멍(눈동자, 흰 반짝임)을 메운다. 검수가 '되살리기'로 keep 점을 찍은 구멍만:
 * 그 점에서 이어진 빈 칸이 그림 가장자리에 닿지 않고(캐릭터에 둘러싸였고) 작으면(남은 칸의 5% 안) 채운다
 */
export function fillHoles(base: Uint8Array, w: number, h: number, keep: number[]): Uint8Array {
  const total = base.reduce((s, v) => s + (v ? 1 : 0), 0);
  const out = base.slice();
  const seen = new Uint8Array(base.length);
  for (const start of keep) {
    if (out[start] || seen[start]) continue;
    const hole: number[] = [];
    const stack = [start];
    seen[start] = 1;
    let open = false;
    while (stack.length && !open && hole.length <= total * 0.05) {
      const i = stack.pop()!;
      hole.push(i);
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) open = true;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= base.length || (j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
        if (!out[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (!open && !stack.length) for (const i of hole) out[i] = 255;
  }
  return out;
}

/** prev 에서 지워졌지만 base 에는 있던 덩어리 중 keep 점이 든 것을 되살린다 (둘째 검수가 '잘못 지워졌다'고 짚은 캐릭터 부분) */
export function restoreParts(prev: Uint8Array, base: Uint8Array, keep: number[], w: number, h: number): Uint8Array {
  const out = prev.slice();
  const seen = new Uint8Array(prev.length);
  for (const start of keep) {
    if (!base[start] || out[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      out[i] = 255;
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (base[j] && !out[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
  }
  return out;
}

/**
 * 검수 한 번을 지금 결과(cur)에 적용한다. 둘째 검수(again)는 첫 결과 위에서만 고친다: 짚은 캐릭터 부분을 base 에서 되살리고,
 * 구멍을 메우고, 이번에 찍은 지울 것만 지운다 (첫 검수에서 지운 것을 다시 가르면 지웠던 꽃이 되살아났다).
 * keep 점도 이번 검수 것만 쓴다 (첫 검수가 풀잎을 캐릭터로 짚었다가 둘째가 지우라고 하면 첫 keep 점이 막았다)
 */
export function applyReview(src: Pixels, base: Uint8Array, cur: Uint8Array, review: Marks, again: boolean): Uint8Array {
  const { width: w, height: h } = src;
  const mask = fillHoles(again ? restoreParts(cur, base, review.keep, w, h) : cur, w, h, review.keep);
  return cutWithMarks(src, mask, review) ?? mask;
}
