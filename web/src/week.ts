// 주마다 리셋되는 것의 기준 때: 매주 목요일 오전 10시 (한국 시간, 제작자 요청 2026-10-31).
// 서버 server/week.ts 와 같은 계산이다 (화면 코드는 서버 코드를 가져오지 않아서 따로 둔다).

export const WEEK = 7 * 86_400_000;
/** 1970-01-01 은 목요일이고, 한국 시간 목요일 10시는 그날 UTC 01시다 */
const THURSDAY_10_KST = 3_600_000;

/** 이번 주가 시작한 때 (지난 목요일 10시, 지금이 목요일 10시 이후면 오늘 10시) */
export function weekStart(now = Date.now()): number {
  return now - ((((now - THURSDAY_10_KST) % WEEK) + WEEK) % WEEK);
}
/** 길드 던전의 한 주 (제작자 2026-11-03 게임 스샷: 길드 던전 입장 횟수는 매주 목요일 오전 10시 30분(한국 시간)에 초기화, 목 9:20~10:30 은 입장 불가):
 *  다른 주간 기능의 목 10시가 아니라 목 10시 30분에 시작한다 (지금이 목 10:00~10:30 이면 아직 지난주) */
export const GD_WEEK_OFFSET = 30 * 60_000;
export function gdWeekStart(now = Date.now()): number {
  return weekStart(now - GD_WEEK_OFFSET) + GD_WEEK_OFFSET;
}

