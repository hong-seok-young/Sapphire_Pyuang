// 우주 배경을 모든 화면 뒤에 깐다 (설정 > 배경화면, src/bgSettings.ts). 그리는 엔진(src/space.ts)은 처음 켤 때 따로 받는다.
// 켜면 <html> 에 space-on 을 달아 홈 칸 바탕만 반투명하게 하고(--bt-a, styles.css), 게임 위 위키 창에서는 쓰지 않는다.
import { useEffect, useRef, useState } from "react";
import type { Me } from "../auth";
import { canUseBg, loadBg, todayScene } from "../bgSettings";
import type { BgCfg } from "../bgSettings";
import { inFloat } from "../platform";
import type { SpaceRun } from "../space";

/** 누르면 하는 일이 있는 곳 (여기를 누르면 별똥별을 부르지 않는다) */
export const EMPTY_NOT =
  "a, button, input, textarea, select, label, summary, [role=button], [role=dialog], [role=tab], [contenteditable], .tile, .tabbar, .search-entry, .bg-pv-panel, .rn-back";

export function SpaceBackground({ me }: { me: Me }) {
  const [cfg, setCfg] = useState<BgCfg>(() => loadBg(me.id));
  const [day, setDay] = useState(todayScene);
  // 설정의 미리 보기가 열린 동안은 쉰다 (미리 보기가 따로 그린다)
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setPaused(!!(e as CustomEvent).detail);
    addEventListener("sapphire:bg-preview", on);
    return () => removeEventListener("sapphire:bg-preview", on);
  }, []);
  useEffect(() => {
    setCfg(loadBg(me.id));
    const on = () => setCfg(loadBg(me.id));
    addEventListener("sapphire:bg", on);
    return () => removeEventListener("sapphire:bg", on);
  }, [me.id]);
  const enabled = cfg.on && canUseBg(me) && !inFloat;
  const scene = cfg.scene === 0 ? day : cfg.scene;
  // 매일 랜덤: 켜 둔 채로 자정을 넘기면 다음 장면으로
  useEffect(() => {
    if (!enabled || cfg.scene !== 0) return;
    const id = setInterval(() => setDay(todayScene()), 10 * 60e3);
    return () => clearInterval(id);
  }, [enabled, cfg.scene]);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("space-on", enabled);
    root.style.setProperty("--bt-a", String(1 - cfg.clear / 100));
    return () => root.classList.remove("space-on");
  }, [enabled, cfg.clear]);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!enabled || paused || !el) return;
    let run: SpaceRun | null = null;
    let dead = false;
    let rt = 0;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const begin = () =>
      import("../space").then(({ startSpace }) => {
        if (dead) return;
        run?.stop();
        run = startSpace(el, { scene, px: cfg.px, still });
      });
    void begin();
    const boom = () => run?.boom();
    // 화면 크기가 크게 바뀌면(돌리기 등) 다시 그린다
    let w = innerWidth, h = innerHeight;
    const resize = () => {
      clearTimeout(rt);
      rt = window.setTimeout(() => {
        if (Math.abs(innerWidth - w) > 40 || Math.abs(innerHeight - h) > 160) { w = innerWidth; h = innerHeight; void begin(); }
      }, 300);
    };
    // 화면 빈 곳을 누르면 그 자리로 별똥별이 날아와 부딪힌다 (단추·칸·글 칸·창은 빼고, 끌어 스크롤한 것은 click 이 안 와서 빠진다)
    let lastTap = 0;
    const tap = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || t.closest(EMPTY_NOT)) return;
      if (e.timeStamp - lastTap < 250) return;
      lastTap = e.timeStamp;
      run?.boom(e.clientX, e.clientY);
    };
    document.addEventListener("click", tap);
    addEventListener("sapphire:bg-boom", boom);
    addEventListener("resize", resize);
    return () => {
      dead = true;
      clearTimeout(rt);
      run?.stop();
      document.removeEventListener("click", tap);
      removeEventListener("sapphire:bg-boom", boom);
      removeEventListener("resize", resize);
    };
  }, [enabled, paused, scene, cfg.px]);
  if (!enabled) return null;
  return <div className="space-bg" ref={host} aria-hidden />;
}
