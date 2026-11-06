// 메뉴 업데이트 표 (제작자 요청): 고친 메뉴는 홈 칸에 'UPDATE' 표와 다른 색 테두리를 단다.
// 그 사람이 업데이트 뒤 그 메뉴에 처음 들어가면 바로 사라진다 (제작자 요청 2026-11-02, 예전에는 하루 동안). 안 들어가도 7일이 지나면 사라진다.
// 들어간 때는 그 기기에 계정별로 적어 둔다 (localStorage, 못 쓰면 표만 계속 보인다).
// 메뉴를 고쳐서 올릴 때마다 여기 그 메뉴의 시각을 바꾼다 (홈 칸의 주소 그대로, 한국 시간).
// 2026-11-01 v1.0 때 모두 비웠고, 2026-11-03 정식 오픈 때 다시 비우고 중개인(v1.1 개편)만 남겼다 (제작자 요청: 오픈하면 업데이트 표시는 다 지우기). 그 뒤 고친 메뉴만 다시 넣는다.
export const MENU_UPDATES: Record<string, string> = {
  // 2026-11-03 정식 오픈 (제작자 '오픈했거든, 나머지는 업데이트 띄우지 말고 중개소 개편된 거만'): 중개인 개편 v1.1 (팝니다·삽니다, 단추 정리)
  "#/market": "2026-11-03T20:00+09:00",
  // 2026-11-04 길드 던전 v1.2 (파티원 시간표, 카드 '입력 전 / 확정')
  "#/match": "2026-11-04T11:55+09:00",
};

const DAY = 86_400_000;
const SHOW_DAYS = 7;

// 새로 연 메뉴 (제작자 요청 2026-11-05 '오픈하자, 버튼 올리고 new 뱃지 하루 동안'): 홈 칸에 'NEW' 를 연 때부터 하루 동안 (들어가 봐도 하루 동안은 그대로).
// 'UPDATE' 와 같은 자리에 달고, 둘 다면 NEW. 메뉴를 새로 열 때 그 칸의 주소와 연 때(한국 시간)를 더한다
export const MENU_NEW: Record<string, string> = {
  // 2026-11-05 v1.3 강화 비교 오픈
  "#/enhance": "2026-11-05T16:30+09:00",
  // 2026-11-06 v1.4 개발 요청 오픈 (11/5 에 한 번 열었다가 닫았다)
  "#/devreq": "2026-11-06T09:15+09:00",
};

/** 홈 칸에 'NEW' 를 달지: 연 때(배포)부터 그 시각 + 하루까지 */
export function showNew(to: string, now = Date.now()): boolean {
  const stamp = MENU_NEW[to];
  return !!stamp && now - Date.parse(stamp) < DAY;
}

interface Seen {
  stamp: string;
  at: number;
}

const storeKey = (user: string) => "sapphire.menuSeen." + user;

function load(user: string): Record<string, Seen> {
  try {
    return JSON.parse(localStorage.getItem(storeKey(user)) ?? "{}") as Record<string, Seen>;
  } catch {
    return {};
  }
}

/** 홈 칸에 'UPDATE' 를 달지: 업데이트 뒤 아직 그 메뉴에 안 들어갔으면 */
export function showUpdate(user: string, to: string, now = Date.now()): boolean {
  const stamp = MENU_UPDATES[to];
  if (!stamp || now - Date.parse(stamp) > SHOW_DAYS * DAY) return false;
  return load(user)[to]?.stamp !== stamp;
}

/** 지금 들어간 화면이 업데이트된 메뉴면 처음 들어간 때를 적는다 (이미 적었으면 그대로) */
export function markMenuVisit(user: string, hash: string) {
  let path = hash;
  try {
    path = decodeURIComponent(hash);
  } catch {
    // 주소가 깨졌으면 그대로 비교
  }
  const to = Object.keys(MENU_UPDATES).find((k) => path === k || path.startsWith(k + "/") || path.startsWith(k + "?"));
  if (!to) return;
  const all = load(user);
  if (all[to]?.stamp === MENU_UPDATES[to]) return;
  all[to] = { stamp: MENU_UPDATES[to], at: Date.now() };
  try {
    localStorage.setItem(storeKey(user), JSON.stringify(all));
  } catch {
    // 저장을 못 하면 표가 계속 보일 뿐이다
  }
}
