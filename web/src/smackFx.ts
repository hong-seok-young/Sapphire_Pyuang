// 운영진 때리기의 타격 효과 (src/pages/Smack.tsx). 일반 · 크리티컬 · 죽음의 일격 셋의 모양은 모두 아래 HIT_FX 한 곳에 있다.
// 모양과 움직임은 제작자가 보낸 인게임 영상(2026-11-10, 마법사가 샌드백을 때리는 장면 셋)을 그대로 따랐다
// (제작자 '그냥 타격, 크리, 데들리 등등 여기서 다 따와', '그림만 따지 말고 애니메이션도 따'):
//  - 데미지 숫자, CRITICAL! · DEADLY! 글자 조각은 영상에서 오린 그림 (자료/scripts/make_smack_marks.py -> data/smack/, 로그인한 길드원에게만)
//  - 움직임은 영상(120장/초)을 장면마다 재서 아래 NORMAL_* · CRIT_* · DEAD_* 표로 옮기고 Web Animations 로 돌린다 (animateNumber)
//  - 일반: 하얀 별빛·주황 고리. 크리티컬: 주황·흰 폭발과 회색 연기(.smk-smoke). 죽음의 일격: 노란 번개 빛살과 검붉은 별(.smk-star)
// 캔버스 불꽃은 생일 스티커의 엔진(birthdayFx.ts Fx)을 같이 쓴다: 누를 때만 돌고, 폰이 끊기면 저절로 가볍게 (Fx.quality).
import { Fx } from "./birthdayFx";

export type HitKind = "normal" | "critical" | "deadly";
export const HIT_KINDS: HitKind[] = ["normal", "critical", "deadly"];

export interface HitFx {
  /** 나올 확률 (셋을 더하면 1) */
  chance: number;
  /** 일반 데미지의 몇 배인지 (제작자 2026-11-10 '죽음의 일격은 3배, 크리는 2배 데미지') */
  mult: number;
  /** 떠오르는 숫자의 모양 (styles.css .smk-num-*) */
  numCls: string;
  /** 숫자 밑에 붙는 영상 글씨 (data/smack/<word>.png) */
  word?: "critical" | "deadly";
  /** 숫자가 떠 있는 때 (ms, 아래 NORMAL_MS · CRIT_MS · DEAD_MS 와 같게) */
  numMs: number;
  /** 맞은 캐릭터가 움찔하는 모양 (styles.css .smk-recoil-*) */
  recoil: string;
  /** 무대 흔들기 (styles.css .smk-shake-*) */
  shake?: string;
  /** 화면 전체 번쩍 (styles.css .smk-flash-*) */
  flash?: string;
  /** 캐릭터를 가르는 베기 줄 (styles.css .smk-slash) */
  slash?: boolean;
  /** 누른 자리의 캔버스 불꽃 */
  burst: (fx: Fx, x: number, y: number) => void;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** 한 점에서 사방으로 튀는 불똥 */
function sparks(fx: Fx, x: number, y: number, n: number, speed: [number, number], colors: string[], life: [number, number], size = 2, trail = 3, g = 260) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2);
    const v = rnd(speed[0], speed[1]);
    fx.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g, drag: 0.08, max: rnd(life[0], life[1]), size, color: colors[i % colors.length], shape: "spark", trailLen: trail });
  }
}

export const HIT_FX: Record<HitKind, HitFx> = {
  // 일반 (영상의 지팡이 평타): 하얀 별빛이 번쩍이고 짧은 빛살, 주황 고리
  normal: {
    chance: 0.8,
    mult: 1,
    numCls: "smk-num-normal",
    numMs: 630,
    recoil: "smk-recoil-normal",
    burst: (fx, x, y) => {
      fx.flash(x, y, "#ffffff", 16, 140);
      fx.flash(x, y, "#fff3a8", 10, 90, 0.03);
      sparks(fx, x, y, 7, [260, 420], ["#ffffff", "#fff2b8", "#ffd56a"], [0.12, 0.22], 1.8, 5, 0);
      fx.ring(x, y, "#ff9a3c", 120, 0.05, 0.3);
    },
  },
  // 크리티컬: 주황·흰 폭발 (연기는 DOM .smk-smoke)
  critical: {
    chance: 0.17,
    mult: 2,
    numCls: "smk-num-critical",
    word: "critical",
    numMs: 740,
    recoil: "smk-recoil-critical",
    burst: (fx, x, y) => {
      fx.flash(x, y, "#ffffff", 30, 200);
      fx.flash(x, y, "#ffb347", 46, 300, 0.03);
      fx.ring(x, y, "#ffd27a", 200, 0.02, 0.3);
      sparks(fx, x, y, 20, [200, 440], ["#fff6c8", "#ffc35c", "#ff8a3d"], [0.22, 0.45], 2.2, 4);
    },
  },
  // 죽음의 일격: 노란 번개 빛살 (검붉은 별은 DOM .smk-star)
  deadly: {
    chance: 0.03,
    mult: 3,
    numCls: "smk-num-deadly",
    word: "deadly",
    numMs: 925,
    recoil: "smk-recoil-deadly",
    shake: "smk-shake-1",
    burst: (fx, x, y) => {
      fx.flash(x, y, "#ffffff", 34, 240);
      fx.flash(x, y, "#ffe14a", 52, 340, 0.04);
      sparks(fx, x, y, 14, [380, 620], ["#ffffff", "#fff27a", "#ffd23a"], [0.18, 0.32], 2.6, 9, 0);
      sparks(fx, x, y, 16, [140, 300], ["#ffe680", "#ffb800"], [0.3, 0.55], 1.8, 4);
    },
  },
};

// 영상에서 오린 숫자·글씨 그림 (자료/scripts/make_smack_marks.py 결과. 숫자 한 자의 가로는 styles.css .smk-dg-*)
const ART = "/data/smack/";
const ART_V = "?v=2";

/** 글씨 하나: 그림 전체 크기(px), 글자 조각마다 그림 안의 자리 [x, y, 가로, 세로] (make_smack_marks.py split_letters 가 찍는 값),
 * 숫자 높이를 1em 으로 한 글씨의 가로(em)와 숫자 가운데에서 글씨 가운데까지(em). 모두 영상에서 잰 값 */
interface WordArt {
  name: "critical" | "deadly";
  size: [number, number];
  letters: [number, number, number, number][];
  width: number;
  at: [number, number];
}
const WORDS: Record<"critical" | "deadly", WordArt> = {
  // 영상 v3 13.6초 '638 CRITICAL!' · v1 4.6초 '604': 숫자 높이 81, 글씨 307x81, 글씨 가운데가 숫자 가운데에서 0.65em 아래
  critical: {
    name: "critical",
    size: [308, 83],
    letters: [[0, 23, 62, 60], [58, 12, 43, 63], [91, 11, 33, 61], [115, 3, 43, 58], [150, 3, 27, 61], [173, 2, 46, 63], [210, 0, 45, 63], [244, 2, 40, 57], [278, 4, 30, 59]],
    width: 3.79,
    at: [0.02, 0.65],
  },
  // 영상 v3 10.0초 '462 DEADLY!': 숫자 높이 102, 글씨 284x103, 글씨 가운데가 숫자 가운데에서 (-7.5, +78.5)
  deadly: {
    name: "deadly",
    size: [283, 103],
    letters: [[0, 0, 102, 103], [73, 35, 42, 61], [106, 34, 44, 62], [138, 34, 48, 65], [176, 40, 38, 53], [206, 38, 39, 53], [239, 13, 44, 87]],
    width: 2.78,
    at: [-0.07, 0.77],
  },
};
const ART_NAMES = [..."0123456789"]
  .map((d) => `digit_${d}`)
  .concat(Object.values(WORDS).flatMap((w) => w.letters.map((_, i) => `${w.name}_${i}`)));
let artReady = false;
let artLoading: Promise<boolean> | null = null;
/** 그림을 미리 받는다. 하나라도 못 받으면(로컬에 자료가 없을 때) 글자 숫자로 */
export function loadSmackArt(): Promise<boolean> {
  if (!artLoading) {
    artLoading = Promise.all(
      ART_NAMES.map(
        (n) =>
          new Promise<boolean>((ok) => {
            const im = new Image();
            im.onload = () => ok(true);
            im.onerror = () => ok(false);
            im.src = ART + n + ".png" + ART_V;
          }),
      ),
    ).then((r) => (artReady = r.every(Boolean)));
  }
  return artLoading;
}
const STARS = 7;

// ── 움직임: 제작자 영상(120장/초, 게임은 40장/초쯤)을 장면마다 재서 옮긴 값. 시간은 숫자가 뜬 때부터 ms, 길이는 숫자 높이(em) ──
// (숫자는 크기·자리를 바꿔 가며 영상에 맞춰 보고(정규화 상호상관), 글씨는 제자리에 붙은 뒤는 같은 방법, 날아오는 동안은 25ms 마다 장면을 보고 쟀다)
// 일반: 커지지 않고 바로 뜨고, 0.63초 동안 일정하게 숫자 높이 1.46배 떠오르고, 마지막 0.06초에 사라진다 (영상 v1 5.6초 '95')
const NORMAL_MS = 630;
const NORMAL_RISE = 1.46;
// 크리티컬: 숫자는 1.5배로 떠서 0.1초에 1배를 지나 0.15초에 0.76배까지 줄었다 출렁이며 0.37초에 1배. 떠오르지 않고 0.65초부터 0.74초에 사라진다 (영상 v1 4.6초 '604')
const CRIT_MS = 740;
const CRIT_SCALE: [number, number][] = [[0, 1.5], [42, 1.45], [50, 1.35], [67, 1.25], [83, 1.15], [100, 1.05], [112, 0.9], [130, 0.8], [150, 0.76], [220, 0.95], [300, 0.92], [370, 1]];
// CRITICAL!: 숫자보다 0.04초 늦게, 20도쯤 기운 채 숫자 아랫부분을 가로질러 나타나 내려오며 펴지고(통째로), 그 사이 물결이 왼쪽에서 오른쪽으로 지나간다(글자마다).
// 0.25초에 제자리. [ms, 가로 옮김, 세로 옮김(최종 자리에서), 기울기(도, 그림 자체의 오른쪽 위로 4도 기울기 위에 더한다)]. 0.47초부터 0.50초에 사라진다
const CRIT_WORD_IN = 40;
const CRIT_WORD: [number, number, number, number][] = [[47, 0.12, -0.88, -20], [72, 0.17, -0.25, -22], [97, 0.03, -0.18, -16], [122, 0.1, -0.07, -3], [147, 0, -0.07, 0], [172, 0, -0.2, 0], [197, 0, -0.2, 0], [222, 0, -0.15, -5], [247, 0, 0, -2], [272, 0, 0, 0]];
// 물결: [ms, 높이(em), 마루가 있는 자리(글씨 왼쪽 0 ~ 오른쪽 1)]. 물결 길이는 글씨 길이 하나
const CRIT_WAVE: [number, number, number][] = [[47, 0, 0], [72, 0.05, 0], [97, 0.2, 0], [122, 0.35, 0.1], [147, 0.55, 0.15], [172, 0.6, 0.4], [197, 0.5, 0.45], [222, 0.15, 0.5], [247, 0, 0.5]];
const CRIT_WORD_OUT: [number, number] = [470, 500];
// 죽음의 일격: 글씨와 숫자가 같이(숫자는 1.5배로 흐릿하게) 떠서 숫자는 0.075초에 1배. 떠오르지 않고 0.88초부터 0.925초에 사라진다 (영상 v3 9.6초 '462')
const DEAD_MS = 925;
const DEAD_SCALE: [number, number, number][] = [[0, 1.5, 0.4], [25, 1.35, 0.76], [42, 1.15, 0.9], [50, 1.05, 1], [75, 1, 1]];
// DEADLY!: 어둡고 좁게 왼쪽 위에서 나타나 0.05초에 밝아지며 자리 잡고, 글자 사이가 한 번 넓어졌다 줄고, 0.3초까지 가로로 살짝 밀렸다 돌아오며 글자마다 들썩인다.
// [ms, 가로 옮김, 세로 옮김, 밝기, 글자 사이(1 = 제자리)]. 0.445초부터 0.47초에 사라진다
const DEAD_WORD: [number, number, number, number, number][] = [[0, -0.38, -0.23, 0.38, 0.67], [25, -0.3, -0.15, 0.45, 0.72], [50, -0.07, -0.02, 1, 0.92], [75, 0.1, 0, 1, 1.08], [100, -0.05, 0, 1, 1.08], [125, -0.12, 0, 1, 1.07], [150, -0.12, 0, 1, 1.06], [175, -0.1, 0, 1, 1.03], [200, -0.07, 0, 1, 1], [250, -0.03, 0, 1, 1], [300, 0, 0, 1, 1]];
// 들썩임 세기: [ms, 위아래(em), 기울기(도)]
const DEAD_WOBBLE: [number, number, number][] = [[50, 0, 0], [75, 0.12, 10], [150, 0.1, 8], [250, 0.04, 3], [350, 0, 0]];
const DEAD_WORD_OUT: [number, number] = [445, 470];

/** [ms, 값…] 표에서 t 때의 값 (사이는 곧게 잇는다) */
function at<T extends number[]>(table: T[], t: number): T {
  if (t <= table[0][0]) return table[0];
  for (let i = 1; i < table.length; i++) {
    const [t1] = table[i];
    if (t <= t1) {
      const a = table[i - 1];
      const b = table[i];
      const k = (t - a[0]) / (t1 - a[0]);
      return a.map((v, j) => v + (b[j] - v) * k) as T;
    }
  }
  return table[table.length - 1];
}
const EASE = "linear";
/** 사라지는 것: 끝 직전까지 보였다가 끝에 0 */
const fadeKeys = (shown: number, gone: number, total: number, start = 0) => {
  const keys: Keyframe[] = [];
  if (start > 0) keys.push({ offset: 0, opacity: 0 }, { offset: (start - 1) / total, opacity: 0 });
  keys.push({ offset: start / total, opacity: 1 }, { offset: shown / total, opacity: 1 }, { offset: Math.min(1, gone / total), opacity: 0 });
  if (gone < total) keys.push({ offset: 1, opacity: 0 });
  return keys;
};
const STEP = 25; // 게임이 그리는 한 장 (40장/초)

/** 일반 타격 한 번의 데미지 범위 (콤보 보너스 전). 크리티컬·죽음의 일격은 여기에 HIT_FX 의 mult 를 곱한다 */
export const BASE_DMG: [number, number] = [80, 160];

/** 콤보 보너스: 콤보 하나에 0.5%, 100 콤보에서 +50% 까지 (서버 MAX_HIT_DAMAGE 는 이것까지 넉넉히) */
export const comboBonus = (combo: number) => 1 + Math.min(combo, 100) * 0.005;

/** 이번 타격의 종류와 데미지 (Math.random 둘: 종류, 데미지) */
export function rollHit(combo: number): { kind: HitKind; dmg: number } {
  const r = Math.random();
  const kind: HitKind = r < HIT_FX.deadly.chance ? "deadly" : r < HIT_FX.deadly.chance + HIT_FX.critical.chance ? "critical" : "normal";
  const [a, b] = BASE_DMG;
  return { kind, dmg: Math.round((a + Math.random() * (b - a)) * HIT_FX[kind].mult * comboBonus(combo)) };
}

/** 운영진의 HP (레벨이 높을수록 많다: Lv.50 이면 9,000) */
export const hpOf = (level: number | null | undefined) => 3000 + Math.max(1, level ?? 30) * 120;

/** K.O. 때 캔버스 불꽃 */
export function koBurst(fx: Fx, x: number, y: number) {
  fx.flash(x, y, "#ffffff", 60, 420);
  fx.ring(x, y, "#ffc35c", 420, 0, 0.7);
  fx.ring(x, y, "#ff7aa8", 320, 0.12, 0.6);
  fx.explode(x, y - 20, "star", ["#ffc35c", "#fff27a"], 0.9, 0.05);
  fx.explode(x, y, "pixel", ["#ffc35c", "#ff6b6b", "#6f8fff", "#ffffff"], 0.8, 0.12);
}

/** 떠오르는 데미지 숫자 하나 (DOM 에 바로 붙였다가 끝나면 뗀다: 누를 때마다 화면을 다시 그리지 않게).
 * x, y 는 맞은 자리: 숫자는 그 위에 서고, 크리티컬 연기와 죽음의 일격 별은 그 자리에서. 움직임은 위의 영상 값으로 Web Animations */
export function spawnNumber(layer: HTMLElement, x: number, y: number, kind: HitKind, dmg: number, reduce: boolean) {
  const spec = HIT_FX[kind];
  const el = document.createElement("span");
  el.className = "smk-num " + spec.numCls + (artReady ? " smk-num-art" : "");
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
  let html = "";
  if (!reduce && kind === "critical") html += '<i class="smk-smoke"></i>';
  if (!reduce && kind === "deadly") {
    html += '<i class="smk-star-wrap">';
    for (let i = 0; i < STARS; i++) {
      const a = (i / STARS) * Math.PI * 2 + rnd(-0.3, 0.3);
      const r = rnd(1.1, 1.9);
      html += `<i class="smk-star" style="--dx:${(Math.cos(a) * r).toFixed(2)}em;--dy:${(Math.sin(a) * r * 0.8).toFixed(2)}em;--rot:${Math.round(rnd(-200, 200))}deg"></i>`;
    }
    html += "</i>";
  }
  const txt = String(Math.max(0, Math.round(dmg)));
  const word = spec.word ? WORDS[spec.word] : null;
  if (artReady) {
    html += '<b class="smk-digits">' + [...txt].map((d) => `<i class="smk-dg smk-dg-${d}"></i>`).join("") + "</b>";
    if (word) {
      const [W, H] = word.size;
      const h = (word.width * H) / W;
      html +=
        `<i class="smk-word" style="width:${word.width}em;height:${h.toFixed(3)}em;margin:${(-h / 2).toFixed(3)}em 0 0 ${(-word.width / 2).toFixed(3)}em;transform:translate(${word.at[0]}em,${word.at[1]}em)">` +
        word.letters
          .map(
            ([lx, ly, lw, lh], i) =>
              `<i class="smk-lt" style="left:${((lx / W) * 100).toFixed(2)}%;top:${((ly / H) * 100).toFixed(2)}%;width:${((lw / W) * 100).toFixed(2)}%;height:${((lh / H) * 100).toFixed(2)}%;background-image:url(${ART}${word.name}_${i}.png${ART_V})"></i>`,
          )
          .join("") +
        "</i>";
    }
  } else {
    html += `<b class="smk-digits">${txt}</b>`;
    if (spec.word) html += `<small>${spec.word === "critical" ? "CRITICAL!" : "DEADLY!"}</small>`;
  }
  el.innerHTML = html;
  layer.appendChild(el);
  animateNumber(el, kind, word, reduce);
  window.setTimeout(() => el.remove(), spec.numMs + 60);
  return el;
}

const BASE = "translate(-50%, -100%)";
function animateNumber(el: HTMLElement, kind: HitKind, word: WordArt | null, reduce: boolean) {
  if (typeof el.animate !== "function") return;
  const opt = (duration: number): KeyframeAnimationOptions => ({ duration, easing: EASE, fill: "both" });
  const digits = el.querySelector<HTMLElement>(".smk-digits");
  const box = el.querySelector<HTMLElement>(".smk-word");
  const letters = [...el.querySelectorAll<HTMLElement>(".smk-lt")];
  const small = el.querySelector<HTMLElement>("small");
  if (kind === "normal") {
    el.animate(fadeKeys(NORMAL_MS - 60, NORMAL_MS, NORMAL_MS), opt(NORMAL_MS));
    if (!reduce) el.animate([{ transform: BASE }, { transform: `${BASE} translateY(-${NORMAL_RISE}em)` }], opt(NORMAL_MS));
    return;
  }
  if (kind === "critical") {
    el.animate(fadeKeys(CRIT_MS - 90, CRIT_MS, CRIT_MS), opt(CRIT_MS));
    const wordFade = fadeKeys(CRIT_WORD_OUT[0], CRIT_WORD_OUT[1], CRIT_WORD_OUT[1], reduce ? 0 : CRIT_WORD_IN);
    if (box) box.animate(wordFade, opt(CRIT_WORD_OUT[1]));
    if (small) small.animate(wordFade, opt(CRIT_WORD_OUT[1]));
    if (reduce) return;
    const scaleEnd = CRIT_SCALE[CRIT_SCALE.length - 1][0];
    digits?.animate(
      CRIT_SCALE.map(([t, s]) => ({ offset: t / scaleEnd, transform: `scale(${s})` })),
      opt(scaleEnd),
    );
    if (box && word) {
      const end = CRIT_WORD[CRIT_WORD.length - 1][0];
      box.animate(
        [{ offset: 0, transform: move(word, CRIT_WORD[0][1], CRIT_WORD[0][2], CRIT_WORD[0][3]) }].concat(
          CRIT_WORD.map(([t, dx, dy, r]) => ({ offset: t / end, transform: move(word, dx, dy, r) })),
        ),
        opt(end),
      );
      const [W] = word.size;
      const waveEnd = CRIT_WAVE[CRIT_WAVE.length - 1][0];
      letters.forEach((lt, i) => {
        const [lx, , lw] = word.letters[i];
        const p = (lx + lw / 2) / W;
        const keys: Keyframe[] = [];
        for (let t = 0; t <= waveEnd; t += STEP / 2) {
          const [, A, c] = at(CRIT_WAVE, t);
          const ph = 2 * Math.PI * (p - c);
          const dy = -A * Math.cos(ph);
          const rot = (Math.atan2(A * 2 * Math.PI * Math.sin(ph), word.width) * 180) / Math.PI;
          keys.push({ offset: t / waveEnd, transform: `translateY(${dy.toFixed(3)}em) rotate(${rot.toFixed(1)}deg)` });
        }
        lt.animate(keys, opt(waveEnd));
      });
    }
    return;
  }
  // 죽음의 일격
  el.animate(fadeKeys(DEAD_MS - 45, DEAD_MS, DEAD_MS), opt(DEAD_MS));
  const wordFade = fadeKeys(DEAD_WORD_OUT[0], DEAD_WORD_OUT[1], DEAD_WORD_OUT[1]);
  if (box) box.animate(wordFade, opt(DEAD_WORD_OUT[1]));
  if (small) small.animate(wordFade, opt(DEAD_WORD_OUT[1]));
  if (reduce) return;
  const scaleEnd = DEAD_SCALE[DEAD_SCALE.length - 1][0];
  digits?.animate(
    DEAD_SCALE.map(([t, s, o]) => ({ offset: t / scaleEnd, transform: `scale(${s})`, opacity: o })),
    opt(scaleEnd),
  );
  if (box && word) {
    const end = DEAD_WORD[DEAD_WORD.length - 1][0];
    box.animate(
      DEAD_WORD.map(([t, dx, dy, b]) => ({ offset: t / end, transform: move(word, dx, dy, 0), filter: `brightness(${b})` })),
      opt(end),
    );
    const [W] = word.size;
    const wobEnd = DEAD_WOBBLE[DEAD_WOBBLE.length - 1][0];
    letters.forEach((lt, i) => {
      const [lx, , lw] = word.letters[i];
      const p = (lx + lw / 2) / W;
      const keys: Keyframe[] = [];
      for (let t = 0; t <= wobEnd; t += STEP) {
        const [, , , , s] = at(DEAD_WORD, t);
        const [, ay, ar] = at(DEAD_WOBBLE, t);
        const dx = (p - 0.5) * word.width * (s - 1);
        const dy = ay * Math.sin(i * 1.9 + t / 40);
        const rot = ar * Math.sin(i * 2.3 + t / 35);
        keys.push({ offset: t / wobEnd, transform: `translate(${dx.toFixed(3)}em, ${dy.toFixed(3)}em) rotate(${rot.toFixed(1)}deg)` });
      }
      lt.animate(keys, opt(wobEnd));
    });
  }
}
/** 글씨 상자의 자리: 최종 자리(word.at)에서 (dx, dy) 옮기고 r 도 기울인다 */
const move = (word: WordArt, dx: number, dy: number, r: number) => `translate(${(word.at[0] + dx).toFixed(3)}em, ${(word.at[1] + dy).toFixed(3)}em) rotate(${r}deg)`;

/** 한 번 그린 애니메이션을 처음부터 다시 (지우고 새로 만들지 않는다, 생일 스티커 replay 와 같은 방법) */
export function replayAnim(el: Element | null) {
  if (!el) return;
  for (const a of el.getAnimations()) {
    a.currentTime = 0;
    a.play();
  }
}
/** 모양(클래스)을 바꿔 그 애니메이션을 처음부터 (같은 모양이면 다시 돌린다) */
export function restartAs(el: HTMLElement | null, prefix: string, cls: string | undefined) {
  if (!el) return;
  const had = [...el.classList].find((c) => c.startsWith(prefix));
  if (had && had !== cls) el.classList.remove(had);
  if (!cls) return;
  if (had === cls) replayAnim(el);
  else el.classList.add(cls);
}
