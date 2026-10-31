// 메뉴 업데이트 표 (제작자 요청): 고친 메뉴는 홈 칸에 'UPDATE' 표와 다른 색 테두리를 단다.
// 그 사람이 업데이트 뒤 처음 그 메뉴에 들어간 때부터 하루 동안 보이고 사라진다. 안 들어가도 7일이 지나면 사라진다.
// 들어간 때는 그 기기에 계정별로 적어 둔다 (localStorage, 못 쓰면 표만 계속 보인다).
// 메뉴를 고쳐서 올릴 때마다 여기 그 메뉴의 시각을 바꾼다 (홈 칸의 주소 그대로, 한국 시간).
export const MENU_UPDATES: Record<string, string> = {
  "#/shop": "2026-10-31T20:20+09:00",
  "#/board": "2026-10-31T17:30+09:00",
  "#/ranking": "2026-11-01T02:30+09:00",
  "#/market": "2026-10-31T12:00+09:00",
  "#/admin": "2026-10-31T15:00+09:00",
  "#/menu/육성 공략": "2026-10-31T22:10+09:00",
  "#/odds": "2026-11-01T02:30+09:00",
  "#/info": "2026-11-01T02:00+09:00",
};

const DAY = 86_400_000;
const SHOW_DAYS = 7;

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

/** 홈 칸에 'UPDATE' 를 달지: 업데이트 뒤 아직 안 들어갔거나, 처음 들어간 지 하루가 안 됐으면 */
export function showUpdate(user: string, to: string, now = Date.now()): boolean {
  const stamp = MENU_UPDATES[to];
  if (!stamp || now - Date.parse(stamp) > SHOW_DAYS * DAY) return false;
  const seen = load(user)[to];
  return !seen || seen.stamp !== stamp || now - seen.at < DAY;
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
