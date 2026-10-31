// 주마다 리셋되는 것의 기준 때: 매주 목요일 오전 10시 (한국 시간, 제작자 요청 2026-10-31).
// 서버 server/week.ts 와 같은 계산이다 (화면 코드는 서버 코드를 가져오지 않아서 따로 둔다).

const WEEK = 7 * 86_400_000;
/** 1970-01-01 은 목요일이고, 한국 시간 목요일 10시는 그날 UTC 01시다 */
const THURSDAY_10_KST = 3_600_000;

/** 이번 주가 시작한 때 (지난 목요일 10시, 지금이 목요일 10시 이후면 오늘 10시) */
export function weekStart(now = Date.now()): number {
  return now - ((((now - THURSDAY_10_KST) % WEEK) + WEEK) % WEEK);
}
