// 시뮬레이터 행운 코인 (개발중, 제작자 요청 2026-11-04 '시도 횟수는 웹에서 유의미한 움직임과 행동을 할 때마다 재화를 주고 그걸로 트라이, 그럼 활성화될 듯').
// 버는 곳: API 미들웨어가 성공한 요청마다 EARN 에서 찾아 넣고(functions/api/_middleware.ts, 답을 돌려준 뒤), 하루 첫 접속은 /api/activity 가 넣는다.
// 쓰는 곳: 시뮬레이터 화면이 시도마다 줄이고 모아서 보낸다 (/api/sim/wallet). D1 sim_wallet, sim_earn (하루 횟수). 기록은 지우지 않는다
import { RANK, TEST_IDS } from "./auth";
import type { Env, User } from "./auth";

/** 개발 중을 미리 보는 사람 (제작자 2026-11-04 '앞으로 개발 중인 것들은 길드마스터 오피서 달팽이 간다이 이렇게 볼 수 있는 거야'): 운영진·앱개발자·테스트 계정과 이 길드원들(묶은 캐릭터 중 하나라도).
 *  닉네임으로 정하므로 닉네임을 바꾸면 고친다. 화면은 src/launcher.ts canPreview (같은 목록). 시뮬레이터 개발 중판과 행운 코인 벌기도 이 사람들 */
export const PREVIEW_PEOPLE = ["달팽이", "간다이"];
export const canSim = (me: User) => RANK[me.role] >= 1 || TEST_IDS.includes(me.id) || [me.id, ...(me.chars ?? [])].some((c) => PREVIEW_PEOPLE.includes(c));

/** 공간 (제작자 2026-11-04 '내가 테스트하는 공간을 따로, 도플갱어로'): 개발 중판(live, 표 sim_*)과 앱개발자 테스트판(test, 표 sim_t_*).
 *  코드는 하나라 배포 한 번이 둘 다에 들어가고, 자료(코인, 순위, 해금, 장비)만 따로다. ?space=test 는 앱개발자와 테스트 계정만 */
export type Space = "live" | "test";
export const tbl = (space: Space) => (space === "test" ? "sim_t_" : "sim_");
export const spaceOf = (request: Request, me: User): Space | null =>
  new URL(request.url).searchParams.get("space") === "test" ? (me.role === "developer" || TEST_IDS.includes(me.id) ? "test" : null) : canSim(me) ? "live" : null;

/** 한국 날짜 (하루 한도를 0시에 새로) */
export const kstDate = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);

export const WELCOME = 100;
export interface EarnRule {
  key: string;
  label: string;
  coin: number;
  /** 하루에 받는 횟수 */
  cap: number;
  method?: string;
  re?: RegExp;
}
export const EARN: EarnRule[] = [
  { key: "visit", label: "하루 첫 접속", coin: 20, cap: 1 },
  { key: "board", label: "게시판 글쓰기", coin: 30, cap: 3, method: "POST", re: /^\/api\/board$/ },
  { key: "comment", label: "게시판 댓글", coin: 5, cap: 10, method: "POST", re: /^\/api\/board\/\d+\/comments$/ },
  { key: "like", label: "게시판 좋아요", coin: 1, cap: 10, method: "PUT", re: /^\/api\/board\/\d+\/like$/ },
  { key: "gd", label: "길드 던전 시간표 확정", coin: 20, cap: 1, method: "POST", re: /^\/api\/gd\/confirm$/ },
  { key: "gdpaint", label: "길드 던전 시간표 칠하기", coin: 2, cap: 5, method: "PUT", re: /^\/api\/gd\/avail$/ },
  { key: "chat", label: "챗봇 질문", coin: 3, cap: 20, method: "POST", re: /^\/api\/chat$/ },
  { key: "market", label: "중개인 물건 올리기", coin: 10, cap: 3, method: "POST", re: /^\/api\/market$/ },
  { key: "want", label: "중개인 살래요 · 팔래요", coin: 3, cap: 5, method: "PUT", re: /^\/api\/market\/\d+\/want$/ },
  { key: "talk", label: "중개인 토론방", coin: 2, cap: 10, method: "POST", re: /^\/api\/market\/\d+\/talk$/ },
  { key: "gold", label: "골드 글", coin: 10, cap: 2, method: "POST", re: /^\/api\/gold$/ },
  { key: "request", label: "의뢰 올리기", coin: 10, cap: 3, method: "POST", re: /^\/api\/requests$/ },
  { key: "accept", label: "의뢰 수락 · 완료", coin: 5, cap: 5, method: "PATCH", re: /^\/api\/requests\/\d+$/ },
  { key: "profile", label: "레벨 · 경험치 기록", coin: 5, cap: 2, method: "PUT", re: /^\/api\/profile$/ },
  { key: "todo", label: "To do 체크", coin: 1, cap: 15, method: "PUT", re: /^\/api\/todo$/ },
  { key: "rent", label: "장비대여 신청", coin: 5, cap: 2, method: "POST", re: /^\/api\/rent\/apply$/ },
];

/** 지갑이 없으면 처음 코인으로 만든다 */
export const ensureWallet = (env: Env, userId: string, space: Space = "live") =>
  env.DB.prepare(`INSERT OR IGNORE INTO ${tbl(space)}wallet (user_id, coins, earned, spent, updated_at) VALUES (?, ?, 0, 0, ?)`).bind(userId, WELCOME, Date.now()).run();

/** 오늘의 도전 (화면 src/simQuest.ts 가 날마다 셋을 고른다): 하나 깰 때마다 */
export const QUEST_COIN = 30;
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
    return true;
  } catch (e) {
    console.error("sim coin", e instanceof Error ? e.message : e);
    return false;
  }
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
export const refillable = (me: { id: string; role: string }) => me.role === "developer" || ["테스트1", "테스트2"].includes(me.id);
export const refillSql = (env: { DB: D1Database }, id: string, space: Space = "live") =>
  env.DB.prepare(`UPDATE ${tbl(space)}wallet SET coins = coins + ?2, earned = earned + ?2, updated_at = ?4 WHERE user_id = ?1 AND coins < ?3`).bind(id, DEV_REFILL, DEV_FLOOR, Date.now());
