// 시뮬레이터 행운 코인 (개발중, 제작자 요청 2026-11-04 '시도 횟수는 웹에서 유의미한 움직임과 행동을 할 때마다 재화를 주고 그걸로 트라이, 그럼 활성화될 듯').
// 버는 곳: 오늘의 도전만 (제작자 2026-11-04 '운영에는 게임 다 빼 줘, 코인이니 뭐네': 게시판 글·챗봇 같은 앱의 일로 코인을 주던 것(EARN, 미들웨어 earnFor)은 뺐다).
// 쓰는 곳: 시뮬레이터 화면이 시도마다 줄이고 모아서 보낸다 (/api/sim/wallet). D1 sim_wallet, sim_earn (하루 횟수). 기록은 지우지 않는다
import type { Env } from "./auth";

/** 한국 날짜 (하루 한도를 0시에 새로) */
export const kstDate = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);

export const WELCOME = 100;

/** 지갑이 없으면 처음 코인으로 만든다 */
export const ensureWallet = (env: Env, userId: string) =>
  env.DB.prepare("INSERT OR IGNORE INTO sim_wallet (user_id, coins, earned, spent, updated_at) VALUES (?, ?, 0, 0, ?)").bind(userId, WELCOME, Date.now()).run();

/** 오늘의 도전 (화면 src/simQuest.ts 가 날마다 셋을 고른다): 하나 깰 때마다 */
export const QUEST_COIN = 30;
export const QUEST_KEYS = ["quest0", "quest1", "quest2"];

/** 그 일로 코인을 준다 (오늘 한도 안이면). 실패해도 하던 일은 그대로. 받았으면 true */
export async function earn(env: Env, userId: string, key: string): Promise<boolean> {
  const rule = QUEST_KEYS.includes(key) ? { key, coin: QUEST_COIN, cap: 1 } : null;
  if (!rule) return false;
  try {
    const now = Date.now();
    const r = await env.DB.prepare("INSERT INTO sim_earn (user_id, day, key, n) VALUES (?1, ?2, ?3, 1) ON CONFLICT(user_id, day, key) DO UPDATE SET n = n + 1 WHERE n < ?4")
      .bind(userId, kstDate(now), key, rule.cap)
      .run();
    if (!r.meta.changes) return false;
    await env.DB.prepare(
      "INSERT INTO sim_wallet (user_id, coins, earned, spent, updated_at) VALUES (?1, ?2 + ?4, ?2, 0, ?3) " +
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

/** 앱개발자(와 그 테스트 계정)는 써 보느라 코인이 모자라지 않게: 100 아래로 내려가면 1000 을 채운다 (제작자 2026-11-04 '나는 개발자니까 돈 다 쓰면 자동으로 기본 코인 좀 넣어 줘').
 *  화면(simRank.ts useCoinState)도 같은 규칙으로 바로 채워 보인다 */
export const DEV_REFILL = 1000;
export const DEV_FLOOR = 100;
export const refillable = (me: { id: string; role: string }) => me.role === "developer" || ["테스트1", "테스트2"].includes(me.id);
export const refillSql = (env: { DB: D1Database }, id: string) =>
  env.DB.prepare("UPDATE sim_wallet SET coins = coins + ?2, earned = earned + ?2, updated_at = ?4 WHERE user_id = ?1 AND coins < ?3").bind(id, DEV_REFILL, DEV_FLOOR, Date.now());
