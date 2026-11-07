// 생일 스티커의 날 (화면 src/birthday.tsx 의 BIRTHDAYS 와 같은 key·때). 생일을 더하면 두 곳 모두 고친다
export const BDAYS: Record<string, { start: number; end: number }> = {
  "village-2026": { start: Date.parse("2026-11-08T00:00:00+09:00"), end: Date.parse("2026-11-09T00:00:00+09:00") },
};
/** 콤보 한 번의 최대 (누르는 사람 화면이 세어 보내므로 터무니없는 값만 막는다) */
export const MAX_COMBO = 2000;
