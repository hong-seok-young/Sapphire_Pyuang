// 헬스 루틴 종목 애니메이션 칸 (제작자 2026-11-17): 종목마다 도트 남성이 그 운동을 되풀이한다. 그리기는 src/fitAnim.ts.
// 한 화면에 수십 개가 떠도 가볍게: 공용 시계 하나가 12fps 로 돌며 보이는 캔버스(IntersectionObserver)만 그리고, 다른 앱에 가 있으면 멈춘다.
// 움직임 줄이기면 한 장면만 그린다.
import { useEffect, useRef } from "react";
import type { Exercise } from "../fit";
import { AH, AW, animKeyOf, drawAnim } from "../fitAnim";

type Sub = { el: HTMLCanvasElement; key: string; on: boolean; start: number };
const subs = new Set<Sub>();
let timer = 0;
let io: IntersectionObserver | null = null;
const STEP = 1000 / 12;
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function tick() {
  if (document.hidden) return;
  const now = performance.now();
  for (const s of subs) {
    if (!s.on) continue;
    const ctx = s.el.getContext("2d");
    if (ctx) drawAnim(ctx, s.key, now - s.start);
  }
}
function ensureLoop() {
  if (timer || reduced()) return;
  timer = window.setInterval(tick, STEP);
}
function stopLoop() {
  if (timer && subs.size === 0) {
    clearInterval(timer);
    timer = 0;
  }
}
function observer() {
  if (io) return io;
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      for (const s of subs) if (s.el === e.target) s.on = e.isIntersecting;
    }
  });
  return io;
}

/** 종목 애니메이션. scale 은 도트 한 칸의 CSS px */
export function FitAnim({ ex, scale = 2, className }: { ex: Pick<Exercise, "key" | "part" | "kind">; scale?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = animKeyOf(ex);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (reduced()) {
      if (ctx) drawAnim(ctx, key, 400);
      return;
    }
    const s: Sub = { el, key, on: true, start: performance.now() - Math.floor(Math.random() * 1000) };
    subs.add(s);
    if (ctx) drawAnim(ctx, key, 0);
    const o = typeof IntersectionObserver === "function" ? observer() : null;
    o?.observe(el);
    ensureLoop();
    return () => {
      o?.unobserve(el);
      subs.delete(s);
      stopLoop();
    };
  }, [key]);
  return <canvas ref={ref} className={"fit-anim" + (className ? " " + className : "")} width={AW} height={AH} style={{ width: AW * scale, height: AH * scale }} aria-hidden />;
}
