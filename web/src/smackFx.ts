// 운영진 때리기의 타격 효과 (src/pages/Smack.tsx). 일반 · 크리티컬 · 죽음의 일격 셋의 모양은 모두 아래 HIT_FX 한 곳에 있다.
// 모양은 제작자가 보낸 인게임 영상(2026-11-10, 마법사가 샌드백을 때리는 장면 셋)을 그대로 따랐다 (제작자 '그냥 타격, 크리, 데들리 등등 여기서 다 따와'):
//  - 데미지 숫자, CRITICAL!, DEADLY! 는 영상에서 오린 그림 (자료/scripts/make_smack_marks.py -> data/smack/, 로그인한 길드원에게만)
//  - 일반: 숫자가 맞은 자리 위에 뜨고 하얀 별빛이 번쩍, 주황 고리, 조금 떠 있다 사라진다
//  - 크리티컬: 숫자가 크게 튀어나왔다 줄고, CRITICAL! 이 왼쪽 아래에서 돌며 날아와 숫자 밑에 붙고, 주황·흰 폭발과 회색 연기
//  - 죽음의 일격: 더 큰 숫자, DEADLY! 가 왼쪽 아래에서 기울어 미끄러져 와 숫자 밑에 붙고, 노란 번개와 검붉은 별
// 시간 모양은 styles.css '운영진 때리기 타격 모양' 묶음 (.smk-num-*, .smk-word-*, .smk-smoke, .smk-star).
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
  /** 숫자가 떠 있는 때 (ms, styles.css 의 애니메이션 길이와 같게) */
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
    numMs: 850,
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
    numMs: 1000,
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
    numMs: 1400,
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
const ART_V = "?v=1";
const ART_NAMES = [..."0123456789"].map((d) => `digit_${d}`).concat(["critical", "deadly"]);
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
 * x, y 는 맞은 자리: 숫자는 그 위에 서고, 크리티컬 연기와 죽음의 일격 별은 그 자리에서 */
export function spawnNumber(layer: HTMLElement, x: number, y: number, kind: HitKind, dmg: number, reduce: boolean) {
  const spec = HIT_FX[kind];
  const el = document.createElement("span");
  el.className = "smk-num " + spec.numCls + (artReady ? " smk-num-art" : "") + (reduce ? " smk-num-still" : "");
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
  if (artReady) {
    html += '<b class="smk-digits">' + [...txt].map((d) => `<i class="smk-dg smk-dg-${d}"></i>`).join("") + "</b>";
    if (spec.word) html += `<i class="smk-word smk-word-${spec.word}"></i>`;
  } else {
    html += `<b class="smk-digits">${txt}</b>`;
    if (spec.word) html += `<small>${spec.word === "critical" ? "CRITICAL!" : "DEADLY!"}</small>`;
  }
  el.innerHTML = html;
  layer.appendChild(el);
  window.setTimeout(() => el.remove(), spec.numMs + 60);
  return el;
}

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
