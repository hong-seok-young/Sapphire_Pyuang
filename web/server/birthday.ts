// 생일 스티커의 날 (화면 src/birthday.tsx 의 BIRTHDAYS 와 같은 key·때). 생일을 더하면 두 곳 모두 고친다
import type { Env } from "./auth";
import { notify } from "./alerts";

export const BDAYS: Record<string, { start: number; end: number; notice: string }> = {
  "village-2026": {
    start: Date.parse("2026-11-08T00:00:00+09:00"),
    end: Date.parse("2026-11-09T00:00:00+09:00"),
    notice: "🎂 오늘은 우리 길드마스터 마을모금함 님 생일이에요! 🎉 앱을 열면 생일 스티커가 떠 있어요 · 눌러서 축하 폭죽을 터뜨리고 콤보 순위에 도전해 보세요 🎆",
  },
};
/** 콤보 한 번의 최대 (누르는 사람 화면이 세어 보내므로 터무니없는 값만 막는다).
 * 처음 2000 이었다가 백돼쥐 님 2140 콤보가 막혔다 (제작자 2026-11-08). 사람이 하루 내내 눌러도 닿지 않을 만큼으로 */
export const MAX_COMBO = 1_000_000;

const has = async (env: Env, key: string) => !!(await env.DB.prepare("SELECT 1 AS x FROM setup WHERE key = ?").bind(key).first());
const claim = async (env: Env, key: string, now: number) =>
  !!(await env.DB.prepare("INSERT OR IGNORE INTO setup (key, done_at) VALUES (?, ?)").bind(key, now).run()).meta.changes;

/**
 * 생일 알림 (제작자 2026-11-07 '11월 8일 되는 순간 바로 전원에게 알림 무조건 보내 화려하게'): 그날 0시가 지나 처음 부른 한 곳이 모두에게(본캐마다 한 번) 앱 알림과
 * 처음 40대 폰 알림을 보낸다. 무료 요금제는 요청 하나에 바깥 요청 50개까지라, 나머지 폰은 부를 때마다 다음 40대씩 (setup 키로 한 곳만).
 * /api/news(모두가 2분마다)와 GitHub Actions bday-notice.yml(0시에 여러 번)이 부른다. 그날이 아니면 읽기도 안 한다. 보낸 폰 수를 돌려준다
 */
export async function announceBday(env: Env, now = Date.now()): Promise<number> {
  let sent = 0;
  for (const [key, d] of Object.entries(BDAYS)) {
    if (now < d.start || now >= d.end) continue;
    const base = `bday_notice_${key}`;
    if (!(await has(env, base))) {
      if (await claim(env, base, now)) {
        // 그날 0시 전 기록(앱개발자 미리 보기)은 지운다 (제작자 2026-11-07 '자정이 되는 순간 내 기록 지우고 올리는 거야')
        await env.DB.prepare("DELETE FROM bday_combo WHERE bday = ? AND at < ?").bind(key, d.start).run();
        await notify(env, "all", "bday", d.notice, "#/", "");
        sent += 1;
      }
      continue;
    }
    // 나머지 폰은 server/push.ts 의 push_queue 가 40대씩 이어 보낸다 (예전에는 여기서 setup 키로 나눠 보냈다)
  }
  return sent;
}
