// 운영진 때리기의 타격 효과 (src/pages/Smack.tsx). 일반 · 크리티컬 · 죽음의 일격 셋의 모양은 모두 아래 HIT_FX 한 곳에 있다.
// **제작자가 인게임 영상(데미지·크리티컬·죽음의 일격 이펙트)을 주면 그 모양으로 HIT_FX 와 styles.css '운영진 때리기 타격 모양' 묶음
// (.smk-num-*, .smk-recoil-*, .smk-flash-*, .smk-slash) 만 고친다** (제작자 2026-11-09 '인게임 영상을 줄게, 그걸 보고 표현해 줘').
// 캔버스 불꽃은 생일 스티커의 엔진(birthdayFx.ts Fx)을 같이 쓴다: 누를 때만 돌고, 폰이 끊기면 저절로 가볍게 (Fx.quality).
import { Fx } from "./birthdayFx";

export type HitKind = "normal" | "critical" | "deadly";
export const HIT_KINDS: HitKind[] = ["normal", "critical", "deadly"];

export interface HitFx {
  /** 나올 확률 (셋을 더하면 1) */
  chance: number;
  /** 한 번 때린 데미지 범위 (콤보 보너스 전) */
  dmg: [number, number];
  /** 떠오르는 숫자의 모양 (styles.css .smk-num-*) */
  numCls: string;
  /** 숫자 위 작은 글 */
  label?: string;
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
function sparks(fx: Fx, x: number, y: number, n: number, speed: [number, number], colors: string[], life: [number, number], size = 2, trail = 3) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2);
    const v = rnd(speed[0], speed[1]);
    fx.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 260, drag: 0.08, max: rnd(life[0], life[1]), size, color: colors[i % colors.length], shape: "spark", trailLen: trail });
  }
}

export const HIT_FX: Record<HitKind, HitFx> = {
  // 일반: 하얀 숫자, 작은 불똥
  normal: {
    chance: 0.8,
    dmg: [80, 160],
    numCls: "smk-num-normal",
    numMs: 800,
    recoil: "smk-recoil-normal",
    burst: (fx, x, y) => {
      fx.flash(x, y, "#ffffff", 14, 120);
      sparks(fx, x, y, 8, [160, 320], ["#ffffff", "#fff2b8"], [0.18, 0.32], 1.6);
    },
  },
  // 크리티컬: 크고 주황·노란 숫자, 'CRITICAL', 주황 고리
  critical: {
    chance: 0.17,
    dmg: [260, 480],
    numCls: "smk-num-critical",
    label: "CRITICAL",
    numMs: 1000,
    recoil: "smk-recoil-critical",
    shake: "smk-shake-1",
    burst: (fx, x, y) => {
      fx.flash(x, y, "#ffb347", 26, 260);
      fx.ring(x, y, "#ffc35c", 220, 0, 0.35);
      sparks(fx, x, y, 22, [220, 460], ["#ffc35c", "#ff8a3d", "#fff27a"], [0.25, 0.5], 2.2, 4);
    },
  },
  // 죽음의 일격: 아주 드물게, 붉고 큰 숫자, 화면이 붉게 번쩍이고 흔들리며 캐릭터를 베는 줄
  deadly: {
    chance: 0.03,
    dmg: [1500, 2600],
    numCls: "smk-num-deadly",
    label: "죽음의 일격",
    numMs: 1500,
    recoil: "smk-recoil-deadly",
    shake: "smk-shake-2",
    flash: "smk-flash-deadly",
    slash: true,
    burst: (fx, x, y) => {
      fx.flash(x, y, "#ffffff", 40, 420);
      fx.flash(x, y, "#ff2a2a", 60, 520, 0.05);
      fx.ring(x, y, "#ff3b3b", 380, 0, 0.55);
      fx.ring(x, y, "#ffffff", 260, 0.08, 0.4);
      sparks(fx, x, y, 46, [260, 640], ["#ff3b3b", "#ffffff", "#ff8a8a", "#7a0000"], [0.4, 0.9], 2.6, 6);
      fx.explode(x, y, "pixel", ["#ff3b3b", "#7a0000", "#ffffff"], 0.7, 0.04);
    },
  },
};

/** 콤보 보너스: 콤보 하나에 0.5%, 100 콤보에서 +50% 까지 (서버 MAX_HIT_DAMAGE 는 이것까지 넉넉히) */
export const comboBonus = (combo: number) => 1 + Math.min(combo, 100) * 0.005;

/** 이번 타격의 종류와 데미지 (Math.random 둘: 종류, 데미지) */
export function rollHit(combo: number): { kind: HitKind; dmg: number } {
  const r = Math.random();
  const kind: HitKind = r < HIT_FX.deadly.chance ? "deadly" : r < HIT_FX.deadly.chance + HIT_FX.critical.chance ? "critical" : "normal";
  const [a, b] = HIT_FX[kind].dmg;
  return { kind, dmg: Math.round((a + Math.random() * (b - a)) * comboBonus(combo)) };
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

/** 떠오르는 데미지 숫자 하나 (DOM 에 바로 붙였다가 끝나면 뗀다: 누를 때마다 화면을 다시 그리지 않게) */
export function spawnNumber(layer: HTMLElement, x: number, y: number, kind: HitKind, dmg: number, reduce: boolean) {
  const spec = HIT_FX[kind];
  const el = document.createElement("span");
  el.className = "smk-num " + spec.numCls + (reduce ? " smk-num-still" : "");
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
  if (spec.label) {
    const s = document.createElement("small");
    s.textContent = spec.label;
    el.appendChild(s);
  }
  const b = document.createElement("b");
  b.textContent = dmg.toLocaleString("ko-KR");
  el.appendChild(b);
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
