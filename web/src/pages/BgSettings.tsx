// 설정 > 앱 설정 > 배경화면 (제작자 2026-11-12): 켜기·끄기, 배경 고르기(매일 랜덤 · 은하수 · 노을 · 성운 · 행성 · 오로라), 픽셀 2px·3px,
// 버튼 투명도 0~100 (홈 칸 바탕만, 아이콘·글씨는 그대로). 바꾸는 대로 뒤의 배경에 바로 보인다 (src/bgSettings.ts).
import { useState } from "react";
import type { Me } from "../auth";
import { BG_NAMES, loadBg, saveBg, todayScene } from "../bgSettings";
import type { BgCfg, BgScene } from "../bgSettings";

export function BgSettingsBody({ me, onChange }: { me: Me; onChange: (c: BgCfg) => void }) {
  const [c, setC] = useState<BgCfg>(() => loadBg(me.id));
  const set = (p: Partial<BgCfg>) => {
    const n = { ...c, ...p };
    setC(n);
    saveBg(me.id, n);
    onChange(n);
  };
  return (
    <div className="bg-set">
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
          <button
            key={n}
            type="button"
            className={"pill" + (c.on && c.scene === i ? " pill-on" : "")}
            onClick={() => set({ scene: i as BgScene, on: true })}
          >
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
      <input
        className="bg-range"
        type="range"
        min={0}
        max={100}
        step={1}
        value={c.clear}
        aria-label="버튼 투명도"
        onChange={(e) => set({ clear: +e.target.value })}
      />
      <button type="button" className="pill bg-boom" disabled={!c.on} onClick={() => dispatchEvent(new Event("sapphire:bg-boom"))}>
        별똥별 충돌 보기
      </button>
    </div>
  );
}
