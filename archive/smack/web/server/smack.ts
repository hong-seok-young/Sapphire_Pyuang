// 운영진 때리기 (개발 요청 #10, 현금술사 님 신청·길마 결재, 제작자 2026-11-09 '우선 나한테만 보이게, 알아서 만들고'):
// 길드원이 스트레스를 풀게 길드마스터·오피서의 캐릭터를 두드린다. 화면 src/pages/Smack.tsx, 효과 src/smackFx.ts, API functions/api/smack.
// 기록은 때린 사람(캐릭터)마다 맞은 운영진마다 한 줄 (D1 smack_stats, 지우지 않음). 게임과 상관없는 놀이라 게임 안전 규칙에 맞는다
import type { Env, Role, User } from "./auth";
import { TEST_IDS } from "./auth";

/**
 * 열기 전에는 앱개발자(와 테스트 계정)만 (화면 launcher.ts 의 smack 칸 developer, App.tsx 도 같이).
 * 열 때 할 일은 CLAUDE.md '운영진 때리기'
 */
export const SMACK_OPEN = false;
export const canSmack = (me: User) => SMACK_OPEN || me.role === "developer" || TEST_IDS.includes(me.id);

/** 한 번 보내는 묶음의 한도 (화면이 3초마다 모아 보낸다: 초당 25번 눌러도 75번쯤) */
export const MAX_BATCH_HITS = 1000;
/** 한 번 때린 데미지의 한도 (죽음의 일격 x 콤보 보너스보다 넉넉히. 화면 smackFx.ts HIT_FX 와 COMBO_BONUS) */
export const MAX_HIT_DAMAGE = 5000;
export const MAX_COMBO = 1_000_000;

export interface SmackTarget {
  id: string;
  role: Role;
  job: string | null;
  level: number | null;
  /** 캐릭터 사진 올린 때 (없으면 null: 직업 엠블럼) */
  avatar: number | null;
}

const TEST_SQL = TEST_IDS.map((id) => `'${id}'`).join(", ");
export const NOT_TEST = (col: string) => `${col} NOT IN (${TEST_SQL})`;

/**
 * 때릴 수 있는 운영진: 길드마스터·오피서 (사람마다 한 번: 부캐를 묶은 사람은 그 역할을 가진 캐릭터 하나, 본캐 먼저). 앱개발자는 빼고,
 * exceptOwner(때리는 사람 자신)도 뺀다
 */
export async function smackTargets(env: Env, exceptOwner?: string): Promise<SmackTarget[]> {
  const rows = await env.DB.prepare(
    "SELECT u.id AS id, u.role AS role, COALESCE(u.main_id, u.id) AS owner, p.job AS job, p.level AS level, a.updated_at AS avatar, " +
      "(SELECT COUNT(*) FROM users d WHERE d.role = 'developer' AND COALESCE(d.main_id, d.id) = COALESCE(u.main_id, u.id)) AS dev " +
      "FROM users u LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN avatars a ON a.user_id = u.id " +
      `WHERE u.role IN ('master', 'officer') AND ${NOT_TEST("u.id")}`,
  ).all<SmackTarget & { owner: string; dev: number }>();
  const byOwner = new Map<string, SmackTarget & { owner: string }>();
  const score = (r: { role: Role; id: string; owner: string }) => (r.role === "master" ? 2 : 1) + (r.id === r.owner ? 0.5 : 0);
  for (const r of rows.results) {
    if (r.dev || r.owner === exceptOwner) continue;
    const had = byOwner.get(r.owner);
    if (!had || score(r) > score(had)) byOwner.set(r.owner, r);
  }
  return [...byOwner.values()]
    .sort((a, b) => (a.role === b.role ? a.id.localeCompare(b.id, "ko") : a.role === "master" ? -1 : 1))
    .map(({ id, role, job, level, avatar }) => ({ id, role, job, level, avatar }));
}
