// 시뮬레이터 행운 코인 (개발중, 제작자 요청 2026-11-04 '시도 횟수는 웹에서 유의미한 움직임과 행동을 할 때마다 재화를 주고 그걸로 트라이, 그럼 활성화될 듯').
// 버는 곳: API 미들웨어가 성공한 요청마다 EARN 에서 찾아 넣고(functions/api/_middleware.ts, 답을 돌려준 뒤), 하루 첫 접속은 /api/activity 가 넣는다.
// 쓰는 곳: 시뮬레이터 화면이 시도마다 줄이고 모아서 보낸다 (/api/sim/wallet). D1 sim_wallet, sim_earn (하루 횟수). 기록은 지우지 않는다
import { RANK, TEST_IDS } from "./auth";
import type { Env, User } from "./auth";

/** 개발 중을 미리 보는 사람 (제작자 2026-11-04 '앞으로 개발 중인 것들은 길드마스터 오피서 달팽이 간다이 이렇게 볼 수 있는 거야'): 운영진·앱개발자·테스트 계정과 이 길드원들(묶은 캐릭터 중 하나라도).
 *  닉네임으로 정하므로 닉네임을 바꾸면 고친다. 화면은 src/launcher.ts canPreview (같은 목록). 시뮬레이터 개발 중판과 행운 코인 벌기도 이 사람들 */
export const PREVIEW_PEOPLE = ["달팽이", "간다이"]; // 힐러님저피1남았어요 는 2026-11-19 넣었다가 2026-11-20 뺐다 (제작자)
/** 2026-11-20 모두에게 열었다 (제작자 '이거도 그냥 오픈하자', 뽑기 칸만 개발 중). 다시 닫으려면 false */
export const SIM_OPEN = true;
export const canSim = (me: User) => RANK[me.role] >= 1 || TEST_IDS.includes(me.id) || [me.id, ...(me.chars ?? [])].some((c) => PREVIEW_PEOPLE.includes(c));

/** 공간 (제작자 2026-11-04 '내가 테스트하는 공간을 따로, 도플갱어로'): 개발 중판(live, 표 sim_*)과 앱개발자 테스트판(test, 표 sim_t_*).
 *  코드는 하나라 배포 한 번이 둘 다에 들어가고, 자료(코인, 순위, 해금, 장비)만 따로다. ?space=test 는 앱개발자와 테스트 계정만 */
export type Space = "live" | "test";
export const tbl = (space: Space) => (space === "test" ? "sim_t_" : "sim_");
// 2026-11-19 테스트판을 뺐다 (제작자 '테스트 메뉴도 빼 버리고 개발 중만 냅두고'): ?space=test 는 더 받지 않고 늘 개발 중판. 표 sim_t_* 는 기록으로 남긴다
/** 시뮬레이터를 쓰고 코인을 버는 사람: 열었으면 모두, 아니면 미리 보는 사람 (canSim) */
export const canUseSim = (me: User) => SIM_OPEN || canSim(me);
export const spaceOf = (_request: Request, me: User): Space | null => (canUseSim(me) ? "live" : null);

// 명성과 계급 (제작자 2026-11-19 '통합 랭킹, 계급으로, 수백 가지, 어디가 끝인지 모르게'): 명성 = 지금까지 쓴 코인 (sim_wallet.spent, 서버 값).
// 계급 n 이 되는 명성 = round(10 x (n / 4)^2.15) (칭호를 66 -> 264개로 늘리며 네 배 촘촘하게. 화면 src/simTier.ts 와 같은 식: 이름·계급장은 화면이 그린다). 이번 주 명성은 week_spent (목요일 10시부터, server/week.ts)
export const tierXp = (n: number) => Math.round(10 * Math.pow(Math.max(0, n) / 4, 2.15));
export function rankOf(xp: number): number {
  let n = Math.max(0, Math.floor(4 * Math.pow(Math.max(0, xp) / 10, 1 / 2.15)));
  while (tierXp(n + 1) <= xp) n++;
  while (n > 0 && tierXp(n) > xp) n--;
  return n;
}
/** 순위·전광판에서 빼는 사람: 테스트 계정과 앱개발자 (코인이 저절로 채워져서 명성이 끝없이 오른다) */
// 앱개발자도 2026-11-20 부터 다른 사람과 같이 순위에 나온다 (제작자 '나도 다른 사람과 동등한 입장에서 시작, 순위에도 반영')
export const NOT_RANKED = (col: string) => `${col} NOT IN (${TEST_IDS.map((t) => `'${t}'`).join(", ")})`;

/** 한국 날짜 (하루 한도를 0시에 새로) */
export const kstDate = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);

export const WELCOME = 1000;
export interface EarnRule {
  key: string;
  label: string;
  coin: number;
  /** 하루에 받는 횟수 */
  cap: number;
  method?: string;
  re?: RegExp;
  /** 그 일을 하는 화면 (버는 법 표에서 누르면 간다) */
  to?: string;
}
// 2026-11-19 모두 열 배로 (제작자 '코인제도 괜찮다, 대신 넉넉하게, 지금보다 열 배씩 더 주면': 처음 코인 100 -> 1000, 버는 일·오늘의 도전·연속 접속 보너스 x10. 장비 값·해금 값은 그대로)
export const EARN: EarnRule[] = [
  { key: "visit", label: "하루 첫 접속", coin: 200, cap: 1 },
  { key: "board", label: "게시판 글쓰기", coin: 300, cap: 3, method: "POST", re: /^\/api\/board$/, to: "#/board" },
  { key: "comment", label: "게시판 댓글", coin: 50, cap: 10, method: "POST", re: /^\/api\/(board|official)\/\d+\/comments$/, to: "#/board" },
  { key: "like", label: "게시판 좋아요", coin: 10, cap: 10, method: "PUT", re: /^\/api\/(board|official)\/\d+\/like$/, to: "#/board" },
  { key: "gd", label: "길드 던전 시간표 확정", coin: 200, cap: 1, method: "POST", re: /^\/api\/gd\/confirm$/, to: "#/match" },
  { key: "gdpaint", label: "길드 던전 시간표 칠하기", coin: 20, cap: 5, method: "PUT", re: /^\/api\/gd\/avail$/, to: "#/match" },
  { key: "gdanswer", label: "길드 던전 후보 확정 · 불참", coin: 50, cap: 3, method: "POST", re: /^\/api\/gd\/answer$/, to: "#/match" },
  { key: "chat", label: "챗봇 질문", coin: 30, cap: 20, method: "POST", re: /^\/api\/chat$/, to: "#/chat" },
  { key: "market", label: "중개인 물건 올리기", coin: 100, cap: 3, method: "POST", re: /^\/api\/market$/, to: "#/market" },
  { key: "want", label: "중개인 살래요 · 팔래요", coin: 30, cap: 5, method: "PUT", re: /^\/api\/market\/\d+\/want$/, to: "#/market" },
  { key: "bid", label: "중개인 경매 입찰", coin: 30, cap: 5, method: "POST", re: /^\/api\/market\/\d+\/bids$/, to: "#/market" },
  { key: "talk", label: "중개인 토론방", coin: 20, cap: 10, method: "POST", re: /^\/api\/market\/\d+\/talk$/, to: "#/market" },
  { key: "gold", label: "골드 글", coin: 100, cap: 2, method: "POST", re: /^\/api\/gold$/, to: "#/market" },
  { key: "request", label: "의뢰 올리기", coin: 100, cap: 3, method: "POST", re: /^\/api\/requests$/, to: "#/requests" },
  { key: "accept", label: "의뢰 수락 · 완료", coin: 50, cap: 5, method: "PATCH", re: /^\/api\/requests\/\d+$/, to: "#/requests" },
  { key: "profile", label: "레벨 · 경험치 기록", coin: 50, cap: 2, method: "PUT", re: /^\/api\/profile$/, to: "#/ranking" },
  { key: "avatar", label: "캐릭터 사진 등록", coin: 100, cap: 1, method: "PUT", re: /^\/api\/avatar$/, to: "#/me" },
  { key: "todo", label: "To do 체크", coin: 10, cap: 15, method: "PUT", re: /^\/api\/todo$/, to: "#/todo" },
  { key: "rent", label: "장비대여 신청", coin: 50, cap: 2, method: "POST", re: /^\/api\/rent\/apply$/, to: "#/rent" },
  { key: "donate", label: "기부함 기부 신청", coin: 150, cap: 2, method: "POST", re: /^\/api\/donate$/, to: "#/donate" },
  { key: "gcoin", label: "성장코인샵 신청", coin: 50, cap: 2, method: "POST", re: /^\/api\/gcoin\/orders$/, to: "#/gcoin" },
  { key: "devreq", label: "개발 요청", coin: 100, cap: 2, method: "POST", re: /^\/api\/devreq$/, to: "#/devreq" },
];

/** 연속 접속 보너스 (2026-11-17 고도화): 어제도 들어왔으면 하루 첫 접속에 더 준다. 2일째 +5 … 7일째부터 +30 (STREAK_STEP x (이어진 날 - 1), STREAK_MAX 까지). sim_earn 의 key 'streak' 에 그날 이어진 날 수 */
export const STREAK_STEP = 50;
export const STREAK_MAX = 300;
export const streakBonus = (days: number) => Math.min(STREAK_MAX, Math.max(0, days - 1) * STREAK_STEP);
/** 장비 팔기 (2026-11-17 고도화): 강화한 장비를 코인으로 판다. 값은 화면이 공식 확률로 셈한다 (만드는 데 드는 평균 코인의 반쯤, 재미로만. 서버는 범위와 하루 횟수만 본다) */
export const SELL_CAP = 40;
export const SELL_MAX = 300_000;

/** 지갑이 없으면 처음 코인으로 만든다 */
export const ensureWallet = (env: Env, userId: string, space: Space = "live") =>
  env.DB.prepare(`INSERT OR IGNORE INTO ${tbl(space)}wallet (user_id, coins, earned, spent, updated_at) VALUES (?, ?, 0, 0, ?)`).bind(userId, WELCOME, Date.now()).run();

/** 오늘의 도전 (화면 src/simQuest.ts 가 날마다 셋을 고른다): 하나 깰 때마다 */
export const QUEST_COIN = 300;
export const QUEST_KEYS = ["quest0", "quest1", "quest2"];

/** 그 일로 코인을 준다 (오늘 한도 안이면). 실패해도 하던 일은 그대로. 받았으면 true */
export async function earn(env: Env, userId: string, key: string, space: Space = "live"): Promise<boolean> {
  const T = tbl(space);
  const rule = EARN.find((r) => r.key === key) ?? (QUEST_KEYS.includes(key) ? { key, label: "오늘의 도전", coin: QUEST_COIN, cap: 1 } : null);
  if (!rule) return false;
  try {
    const now = Date.now();
    const r = await env.DB.prepare(`INSERT INTO ${T}earn (user_id, day, key, n) VALUES (?1, ?2, ?3, 1) ON CONFLICT(user_id, day, key) DO UPDATE SET n = n + 1 WHERE n < ?4`)
      .bind(userId, kstDate(now), key, rule.cap)
      .run();
    if (!r.meta.changes) return false;
    await env.DB.prepare(
      `INSERT INTO ${T}wallet (user_id, coins, earned, spent, updated_at) VALUES (?1, ?2 + ?4, ?2, 0, ?3) ` +
        "ON CONFLICT(user_id) DO UPDATE SET coins = coins + ?2, earned = earned + ?2, updated_at = ?3",
    )
      .bind(userId, rule.coin, now, WELCOME)
      .run();
    if (key === "visit") await streakEarn(env, userId, space, now).catch((e) => console.error("sim streak", e instanceof Error ? e.message : e));
    return true;
  } catch (e) {
    console.error("sim coin", e instanceof Error ? e.message : e);
    return false;
  }
}

/** 하루 첫 접속 뒤: 어제까지 이어 들어온 날 수로 연속 접속 보너스를 준다 (오늘 포함 days, 'streak' 줄에 days 를 적어 두 번 주지 않는다) */
async function streakEarn(env: Env, userId: string, space: Space, now: number): Promise<void> {
  const T = tbl(space);
  const today = kstDate(now);
  const days = new Set(
    ((await env.DB.prepare(`SELECT day FROM ${T}earn WHERE user_id = ? AND key = 'visit' AND day >= ? AND day < ?`).bind(userId, kstDate(now - 40 * 86_400_000), today).all<{ day: string }>()).results ?? []).map((r) => r.day),
  );
  let streak = 1;
  for (let d = 1; d <= 40 && days.has(kstDate(now - d * 86_400_000)); d++) streak++;
  const r = await env.DB.prepare(`INSERT INTO ${T}earn (user_id, day, key, n) VALUES (?1, ?2, 'streak', ?3) ON CONFLICT(user_id, day, key) DO NOTHING`).bind(userId, today, streak).run();
  const bonus = streakBonus(streak);
  if (!r.meta.changes || !bonus) return;
  await env.DB.prepare(`UPDATE ${T}wallet SET coins = coins + ?2, earned = earned + ?2, updated_at = ?3 WHERE user_id = ?1`).bind(userId, bonus, now).run();
}

/** 장비를 팔아 코인을 받는다 (하루 SELL_CAP 번, 한 번에 SELL_MAX 까지). 됐으면 true */
export async function sellGear(env: Env, userId: string, gain: number, space: Space): Promise<boolean> {
  if (!(gain >= 1 && gain <= SELL_MAX)) return false;
  const now = Date.now();
  const r = await env.DB.prepare(`INSERT INTO ${tbl(space)}earn (user_id, day, key, n) VALUES (?1, ?2, 'sell', 1) ON CONFLICT(user_id, day, key) DO UPDATE SET n = n + 1 WHERE n < ?3`)
    .bind(userId, kstDate(now), SELL_CAP)
    .run();
  if (!r.meta.changes) return false;
  await env.DB.prepare(`UPDATE ${tbl(space)}wallet SET coins = coins + ?2, earned = earned + ?2, updated_at = ?3 WHERE user_id = ?1`).bind(userId, Math.round(gain), now).run();
  return true;
}

/** 미들웨어: 성공한 요청이 버는 일이면 */
export async function earnFor(env: Env, userId: string, method: string, path: string): Promise<void> {
  const rule = EARN.find((r) => r.method === method && r.re?.test(path));
  if (rule) await earn(env, userId, rule.key);
}

/** 앱개발자(와 그 테스트 계정)는 써 보느라 코인이 모자라지 않게: 100 아래로 내려가면 1000 을 채운다 (제작자 2026-11-04 '나는 개발자니까 돈 다 쓰면 자동으로 기본 코인 좀 넣어 줘').
 *  화면(simRank.ts useCoinState)도 같은 규칙으로 바로 채워 보인다 */
export const DEV_REFILL = 1000;
export const DEV_FLOOR = 100;
// 2026-11-20 앱개발자는 빼고 테스트 계정만 (제작자 '나도 다른 사람과 동등한 입장에서')
export const refillable = (me: { id: string; role: string }) => ["테스트1", "테스트2"].includes(me.id);
export const refillSql = (env: { DB: D1Database }, id: string, space: Space = "live") =>
  env.DB.prepare(`UPDATE ${tbl(space)}wallet SET coins = coins + ?2, earned = earned + ?2, updated_at = ?4 WHERE user_id = ?1 AND coins < ?3`).bind(id, DEV_REFILL, DEV_FLOOR, Date.now());
