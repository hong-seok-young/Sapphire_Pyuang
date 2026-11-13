/**
 * 배경화면 설정 (설정 > 앱 설정 > 배경화면, 제작자 2026-11-12 '배경화면 설정하기 누르면 픽셀도 2px 3px, 버튼 투명도 0~100, 배경도 고르게, 아니면 매일 랜덤').
 * 이 기기에 계정마다 둔다 (폰마다 성능·취향이 달라서). 바꾸면 'sapphire:bg' 로 알려 배경(pages/SpaceBg.tsx)이 바로 바뀐다.
 * 모두가 쓴다 (제작자 2026-11-13 '모두에게 보이게 해도 돼', 처음엔 미리 보는 사람만). 처음은 꺼짐.
 */
import type { Me } from "./auth";

/** 0 = 매일 랜덤, 1~5 = 장면 */
export type BgScene = 0 | 1 | 2 | 3 | 4 | 5;
export interface BgCfg {
  on: boolean;
  scene: BgScene;
  /** 도트 한 칸의 크기 (CSS 픽셀) */
  px: 2 | 3;
  /** 홈 칸(단추) 바탕의 투명도 0~100 (0 = 불투명, 100 = 완전 투명). 아이콘과 글씨는 그대로 */
  clear: number;
}
export const BG_NAMES = ["매일 랜덤", "은하수", "노을", "성운", "행성", "오로라"] as const;
const DEF: BgCfg = { on: false, scene: 0, px: 2, clear: 40 };
const key = (id: string) => `sapphire.bg.${id}`;

export const canUseBg = (_me: Me) => true;

export function loadBg(id: string): BgCfg {
  try {
    const v = JSON.parse(localStorage.getItem(key(id)) || "null");
    if (v && typeof v === "object") {
      return {
        on: !!v.on,
        scene: ([0, 1, 2, 3, 4, 5].includes(v.scene) ? v.scene : 0) as BgScene,
        px: v.px === 3 ? 3 : 2,
        clear: Math.max(0, Math.min(100, Math.round(+v.clear || 0))),
      };
    }
  } catch {
    /* 저장소를 못 쓰면 기본값 */
  }
  return { ...DEF };
}

export function saveBg(id: string, cfg: BgCfg) {
  try {
    localStorage.setItem(key(id), JSON.stringify(cfg));
  } catch {
    /* 저장 못 해도 이번에 연 동안은 그대로 */
  }
  dispatchEvent(new CustomEvent("sapphire:bg", { detail: cfg }));
}

/** 한국 날짜로 오늘의 장면 (하루 동안 같고, 어제와는 다르게) */
export function todayScene(now = Date.now()): number {
  const day = Math.floor((now + 9 * 3600e3) / 86400e3);
  const h = (d: number) => {
    const s = Math.sin(d * 12.9898 + 4.1414) * 43758.5453;
    return Math.floor((s - Math.floor(s)) * 5) + 1;
  };
  const today = h(day);
  return today === h(day - 1) ? (today % 5) + 1 : today;
}
