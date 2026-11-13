// 설정 > 앱 설정 > 배경화면 (제작자 2026-11-12): 켜기·끄기, 배경 고르기(매일 랜덤 · 은하수 · 노을 · 성운 · 행성 · 오로라), 픽셀 2px·3px,
// 버튼 투명도 0~100 (홈 칸 바탕만, 아이콘·글씨는 그대로). 바꾸는 대로 뒤의 배경에 바로 보인다 (src/bgSettings.ts).
// '미리 보기' (제작자 2026-11-13 '초안 보여줬듯이 미리보기 느낌으로, 지금은 설정창에서 만지는데 배경 하나도 안 보임'): 화면 가득 배경과 내 홈 칸을 띄우고
// 아래 조절 칸에서 바꾸는 대로 보인다. 켜기 전에도 볼 수 있고 '적용'을 누르면 켠다. 미리 보는 동안 뒤의 배경은 쉰다 (SpaceBg.tsx).
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Me } from "../auth";
import { BG_NAMES, loadBg, saveBg, todayScene } from "../bgSettings";
import type { BgCfg, BgScene } from "../bgSettings";
import { useBackClose } from "../backClose";
import { canSee, gridSlots, itemOf, loadLayout, useLauncher } from "../launcher";
import type { LaunchItem } from "../launcher";
import type { SpaceRun } from "../space";
import { FitLine, PixelIcon } from "../ui";
import { TileIcon } from "./Home";

export function BgSettingsBody({ me, onChange }: { me: Me; onChange: (c: BgCfg) => void }) {
  const [c, setC] = useState<BgCfg>(() => loadBg(me.id));
  const [preview, setPreview] = useState(false);
  const set = (p: Partial<BgCfg>) => {
    const n = { ...c, ...p };
    setC(n);
    saveBg(me.id, n);
    onChange(n);
  };
  return (
    <div className="bg-set">
      <button type="button" className="btn bg-pv-open" onClick={() => setPreview(true)}>
        미리 보기
      </button>
      <div className="pill-row bg-set-row">
        <button type="button" className={"pill" + (!c.on ? " pill-on" : "")} onClick={() => set({ on: false })}>
          끄기
        </button>
        <button type="button" className={"pill" + (c.on ? " pill-on" : "")} onClick={() => set({ on: true })}>
          켜기
        </button>
      </div>
      <div className="bg-set-label">배경</div>
      <div className="bg-scenes">
        {BG_NAMES.map((n, i) => (
          <button key={n} type="button" className={"pill" + (c.on && c.scene === i ? " pill-on" : "")} onClick={() => set({ scene: i as BgScene, on: true })}>
            {n}
          </button>
        ))}
      </div>
      {c.scene === 0 && <div className="bg-set-note">오늘은 {BG_NAMES[todayScene()]}</div>}
      <div className="bg-set-label">픽셀</div>
      <div className="pill-row bg-set-row">
        {([2, 3] as const).map((v) => (
          <button key={v} type="button" className={"pill" + (c.px === v ? " pill-on" : "")} onClick={() => set({ px: v, on: true })}>
            {v}px
          </button>
        ))}
      </div>
      <div className="bg-set-label">
        버튼 투명도 <b>{c.clear}%</b>
      </div>
      <input className="bg-range" type="range" min={0} max={100} step={1} value={c.clear} aria-label="버튼 투명도" onChange={(e) => set({ clear: +e.target.value })} />
      {preview && <BgPreview me={me} cfg={c} set={set} onClose={() => setPreview(false)} />}
    </div>
  );
}

/** 화면 가득 미리 보기: 배경 + 내 홈(맨 위 줄, 검색 칸, 홈 칸) + 아래 조절 칸 */
function BgPreview({ me, cfg, set, onClose }: { me: Me; cfg: BgCfg; set: (p: Partial<BgCfg>) => void; onClose: () => void }) {
  useBackClose(true, onClose);
  const [onlyBg, setOnlyBg] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const run = useRef<SpaceRun | null>(null);
  const scene = cfg.scene === 0 ? todayScene() : cfg.scene;
  // 미리 보는 동안 뒤의 배경은 쉰다 (둘이 같이 돌면 폰이 무겁다)
  useEffect(() => {
    dispatchEvent(new CustomEvent("sapphire:bg-preview", { detail: true }));
    return () => void dispatchEvent(new CustomEvent("sapphire:bg-preview", { detail: false }));
  }, []);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    void import("../space").then(({ startSpace }) => {
      if (dead) return;
      run.current?.stop();
      run.current = startSpace(el, { scene, px: cfg.px, still });
    });
    return () => {
      dead = true;
      run.current?.stop();
      run.current = null;
    };
  }, [scene, cfg.px]);
  useEffect(() => {
    loadLayout(me);
  }, [me]);
  const L = useLauncher();
  const tiles = gridSlots(L.layout)
    .map((k) => (k ? itemOf(k) : undefined))
    .filter((t): t is LaunchItem => !!t && canSee(t, me) && !t.soon)
    .slice(0, 12);
  const names = ["랜덤", "은하수", "노을", "성운", "행성", "오로라"];
  return createPortal(
    <div className="bg-preview" style={{ "--bt-a": 1 - cfg.clear / 100 } as CSSProperties}>
      <div className="space-bg" ref={host} aria-hidden />
      {!onlyBg && (
        <div className="bg-pv-home" aria-hidden>
          <div className="bg-pv-hero">
            <img src="/guild-mark.png" alt="" />
            <div>
              <div className="bg-pv-title">
                Sapphire <small>web</small>
              </div>
              <div className="bg-pv-sub">사파이어 길드 포탈</div>
            </div>
          </div>
          <div className="search-entry">
            <PixelIcon name="search" size={16} /> 아이템, 몬스터, 사냥터 검색
          </div>
          <div className="tiles home-tiles">
            {tiles.map((t) => (
              <div key={t.key} className={"tile" + (t.ring ? ` tile-ring tile-ring-${t.ring}` : "")}>
                {t.ring && <i className="tile-ring-fx" />}
                {t.ribbon && <span className="tile-ribbon">{t.ribbon}</span>}
                <span className="tile-icon">
                  <TileIcon t={t} />
                </span>
                <FitLine className="tile-title" text={t.title} wrap={false} />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-pv-panel">
        <div className="bg-pv-row6">
          {names.map((n, i) => (
            <button key={n} type="button" className={"pill" + (cfg.scene === i ? " pill-on" : "")} onClick={() => set({ scene: i as BgScene })}>
              {n}
            </button>
          ))}
        </div>
        <div className="bg-pv-row4">
          {([2, 3] as const).map((v) => (
            <button key={v} type="button" className={"pill" + (cfg.px === v ? " pill-on" : "")} onClick={() => set({ px: v })}>
              {v}px
            </button>
          ))}
          <button type="button" className={"pill" + (onlyBg ? " pill-on" : "")} onClick={() => setOnlyBg((v) => !v)}>
            배경만
          </button>
          <button type="button" className="pill" onClick={() => run.current?.boom()}>
            충돌
          </button>
        </div>
        <label className="bg-pv-clear">
          <span>
            버튼 투명도 <b>{cfg.clear}%</b>
          </span>
          <input className="bg-range" type="range" min={0} max={100} step={1} value={cfg.clear} onChange={(e) => set({ clear: +e.target.value })} />
        </label>
        <div className="bg-pv-row2">
          <button type="button" className="pill" onClick={() => { set({ on: false }); onClose(); }}>
            끄기
          </button>
          <button type="button" className="pill pill-on" onClick={() => { set({ on: true }); onClose(); }}>
            적용
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
