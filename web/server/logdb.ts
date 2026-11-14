// 사용 기록 DB 2~10 (제작자 요청 2026-11-02: 'DB 10개를 미리 해 놔', '1부터 채우고 2 3 4 진행하고 10까지 차면 1을 비우고').
// Cloudflare 무료 요금제는 DB 하나 500MB, 계정에 DB 10개(합쳐 5GB)까지다 (CLAUDE.md '서버는 무조건 무료').
// DB 1(sapphire-accounts, env.DB)은 계정·글·사진 모두라 비우지 않는다. 가장 빨리 쌓이는 사용 기록(activity)만 DB 2 부터 차례로 채우고,
// 쓰던 DB 가 LOG_FULL 을 넘으면 다음 DB 로 넘어간다. DB 10 다음은 다시 DB 2: 그때 DB 2 에 남은 가장 오래된 기록은 자동 배포(scripts/ci-d1.mjs)가
// DB 를 지웠다가 새로 만들어 비운다 (행을 지우면 무료 쓰기 한도 하루 10만 줄을 다 쓴다). 비우는 것은 지금 DB 가 절반을 넘었을 때 미리 한다.
// 이 기능 전의 기록은 DB 1 의 activity 에 그대로 두고 가장 오래된 묶음으로 같이 읽는다.
// 어느 DB 를 언제부터 썼는지는 DB 1 의 log_ring 에 둔다 (n, started_at, base). 기록 번호(id)는 DB 를 넘어가도 이어진다:
// 새 DB 는 앞 DB 의 마지막 번호 + GAP 부터 (넘어가는 동안 다른 서버가 앞 DB 에 조금 더 써도 번호가 겹치지 않게).
import type { Env } from "./auth";
import { remoteLog } from "./remoteD1";

/** 사용 기록 DB 번호 (wrangler.toml 의 LOG2 ~ LOG10, D1 sapphire-log-2 ~ 10) */
export const LOG_NUMS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
/** 이만큼 차면 다음 DB 로 (무료 한도 500MB 에 조금 남겨 둔다) */
export const LOG_FULL = 450 * 1024 * 1024;
const GAP = 100_000;
/**
 * 둘째 Cloudflare 계정의 사용 기록 DB (제작자 2026-11-14 '사용 기록 쪽에서 쓰는 건 새로운 계정으로 옮겨', server/remoteD1.ts).
 * 설정(LOG_REMOTE_URL·LOG_REMOTE_KEY)이 있으면 새 기록은 여기에 쓰고, 예전 기록(DB 1~10)은 그대로 두고 이어서 읽는다.
 * 그 계정의 D1 한도를 따로 써서 사용 기록을 아무리 읽어도 계정·글 DB 의 하루 읽기 한도를 쓰지 않는다
 */
export const REMOTE_N = 101;

/** 사용 기록 표 (schema.sql 의 activity 와 같다. scripts/ci-d1.mjs 가 schema-log.sql 로 넣는 것과도 같게) */
export const LOG_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL, what TEXT NOT NULL, detail TEXT, " +
    "via TEXT, ip TEXT, place TEXT, device TEXT, dev TEXT, at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS activity_at ON activity (at)",
  "CREATE INDEX IF NOT EXISTS activity_user_at ON activity (user_id, at)",
];

export interface LogDb {
  /** DB 번호 (1 은 계정 DB 의 예전 기록) */
  n: number;
  db: D1Database;
  /** 이 DB 에 쓰기 시작한 때 (DB 1 은 0) */
  since: number;
  /** 이 DB 의 기록 번호는 base 보다 크다 */
  base: number;
}

export function logBinding(env: Env, n: number): D1Database | undefined {
  if (n === REMOTE_N) return remoteLog(env);
  return (env as unknown as Record<string, D1Database | undefined>)[`LOG${n}`];
}

export const nextLog = (n: number) => LOG_NUMS[(LOG_NUMS.indexOf(n) + 1) % LOG_NUMS.length];

interface RingRow {
  n: number;
  started_at: number;
  base: number;
}
let cache: { at: number; rows: RingRow[] } | null = null;

async function ringRows(env: Env, fresh = false): Promise<RingRow[]> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.rows;
  const { results } = await env.DB.prepare("SELECT n, started_at, base FROM log_ring WHERE started_at IS NOT NULL ORDER BY started_at DESC").all<RingRow>();
  cache = { at: Date.now(), rows: results };
  return results;
}

/** 기록이 있는 DB, 새것부터. 마지막은 DB 1 (이 기능 전 기록) */
export async function logDbs(env: Env): Promise<LogDb[]> {
  let rows: RingRow[] = [];
  try {
    rows = await ringRows(env);
  } catch {
    // log_ring 이 아직 없으면(배포 전 DB) 예전처럼 DB 1 만
  }
  const out: LogDb[] = [];
  for (const r of rows) {
    const db = logBinding(env, r.n);
    if (db) out.push({ n: r.n, db, since: r.started_at, base: r.base });
  }
  out.push({ n: 1, db: env.DB, since: 0, base: 0 });
  return out;
}

/** from 뒤의 기록이 있을 수 있는 DB 만 (새것부터) */
export function covering(list: LogDb[], from: number): LogDb[] {
  const out: LogDb[] = [];
  for (const d of list) {
    out.push(d);
    if (d.since <= from) break;
  }
  return out;
}

/** 지금 쓰는 DB. 처음이면 DB 2 를 연다 (LOG 바인딩이 없으면 DB 1) */
let remoteFailedAt = 0;

export async function currentLog(env: Env): Promise<LogDb> {
  const list = await logDbs(env);
  // 둘째 계정으로 옮긴다 (한 번만, 번호는 지금 DB 의 마지막 번호 + GAP 부터). 일꾼이 안 되면 5분 동안은 지금 DB 에 그대로 쓴다
  if (list[0].n !== REMOTE_N && remoteLog(env) && Date.now() - remoteFailedAt > 5 * 60_000) {
    try {
      const top = await list[0].db.prepare("SELECT MAX(id) AS m FROM activity").first<{ m: number | null }>();
      await startLog(env, REMOTE_N, (top?.m ?? list[0].base) + GAP);
      const again = await logDbs(env);
      if (again[0].n === REMOTE_N) return again[0];
    } catch (e) {
      remoteFailedAt = Date.now();
      // 왜 못 옮겼는지 남긴다 (D1 감시 d1-guard 가 찍는다, 주소는 지움)
      const msg = String(e instanceof Error ? e.message : e).replace(/https?:\/\/\S+/g, "(주소)").slice(0, 160);
      await env.DB.prepare("INSERT OR REPLACE INTO setup (key, done_at) VALUES (?, ?)").bind(`log_remote_err:${msg}`, Date.now()).run().catch(() => {});
    }
  } else if (list[0].n !== REMOTE_N && !remoteLog(env)) {
    await env.DB.prepare("INSERT OR IGNORE INTO setup (key, done_at) VALUES ('log_remote_unset', ?)").bind(Date.now()).run().catch(() => {});
  }
  if (list[0].n !== 1) return list[0];
  if (!logBinding(env, LOG_NUMS[0])) return list[0];
  const top = await env.DB.prepare("SELECT MAX(id) AS m FROM activity").first<{ m: number | null }>();
  await startLog(env, LOG_NUMS[0], (top?.m ?? 0) + GAP);
  return (await logDbs(env))[0];
}

async function startLog(env: Env, n: number, base: number): Promise<void> {
  const db = logBinding(env, n);
  if (!db) return;
  await db.batch(LOG_SCHEMA.map((s) => db.prepare(s)));
  // 둘이 함께 넘어가려 해도 한 곳만 (이미 쓰는 DB 는 건드리지 않는다)
  await env.DB.prepare(
    "INSERT INTO log_ring (n, started_at, base) VALUES (?1, ?2, ?3) ON CONFLICT(n) DO UPDATE SET started_at = ?2, base = ?3 WHERE log_ring.started_at IS NULL",
  )
    .bind(n, Date.now(), base)
    .run();
  await ringRows(env, true);
}

/**
 * 쓰던 DB 가 찼다: 다음 DB 로. 다음 DB 에 아직 가장 오래된 기록이 있으면(자동 배포가 아직 못 비웠으면) 그대로 쓰고
 * 앱개발자에게 한 번 알린다 (500MB 를 넘으면 기록만 안 남고 앱은 그대로 돈다)
 */
export async function advanceLog(env: Env, cur: LogDb, alarm: (text: string) => Promise<void>): Promise<void> {
  if (cur.n === 1) return;
  if (cur.n === REMOTE_N) {
    // 둘째 계정은 DB 하나: 거의 차면 알리기만 한다 (500MB 를 넘으면 기록만 안 남고 앱은 그대로)
    const res = await env.DB.prepare("INSERT OR IGNORE INTO setup (key, done_at) VALUES (?, ?)").bind(`log_full_remote_${cur.since}`, Date.now()).run();
    if (res.meta.changes) await alarm("둘째 계정의 사용 기록 DB 가 거의 찼어요. 그 계정에 DB 를 하나 더 만들어 이어 쓰게 해야 해요");
    return;
  }
  const next = nextLog(cur.n);
  const used = logBinding(env, next)
    ? await env.DB.prepare("SELECT started_at FROM log_ring WHERE n = ? AND started_at IS NOT NULL").bind(next).first<{ started_at: number }>()
    : { started_at: 0 }; // 다음 DB 를 못 만들었다 (무료 10개를 넘는 등, scripts/ci-d1.mjs)
  if (used) {
    const key = `log_full_${cur.n}_${cur.since}`;
    const res = await env.DB.prepare("INSERT OR IGNORE INTO setup (key, done_at) VALUES (?, ?)").bind(key, Date.now()).run();
    if (res.meta.changes) await alarm(`사용 기록 DB ${cur.n}이 다 찼는데 다음 DB ${next}를 아직 못 비웠어요. 배포를 한 번 돌리면 가장 오래된 기록을 비우고 넘어가요`);
    return;
  }
  const top = await cur.db.prepare("SELECT MAX(id) AS m FROM activity").first<{ m: number | null }>();
  await startLog(env, next, (top?.m ?? cur.base) + GAP);
}

/** 여러 DB 에 같은 물음을 하고 줄을 모은다 (새 DB 것부터) */
export async function fromLogs<T>(list: LogDb[], make: (db: D1Database) => D1PreparedStatement): Promise<T[]> {
  // DB 마다 따로라 한꺼번에 묻는다 (차례로 기다리지 않게, 2026-11-04 사용 기록이 느려서)
  const parts = await Promise.all(
    list.map(async (d) => {
      try {
        return (await make(d.db).all<T>()).results;
      } catch {
        return [] as T[]; // 표가 아직 없는 DB (막 만든 DB)
      }
    }),
  );
  return parts.flat();
}

/** 새것부터 limit 줄까지 (번호가 DB 순서대로 이어져서 이어 붙이면 그대로 새것부터다) */
export async function newestLogs<T>(list: LogDb[], limit: number, make: (db: D1Database, left: number) => D1PreparedStatement): Promise<T[]> {
  const out: T[] = [];
  for (const d of list) {
    if (out.length >= limit) break;
    try {
      out.push(...(await make(d.db, limit - out.length).all<T>()).results);
    } catch {
      // 표가 아직 없는 DB
    }
  }
  return out;
}

/** 사용 기록 DB 2~10 모두에 같은 일 (닉네임 바꾸기, 계정 삭제). 표가 없는 DB 는 건너뛴다 */
export async function eachLog(env: Env, sql: string, ...binds: unknown[]): Promise<void> {
  await Promise.all(
    [...LOG_NUMS, REMOTE_N].map(async (n) => {
      const db = logBinding(env, n);
      if (!db) return;
      try {
        await db.prepare(sql).bind(...binds).run();
      } catch {
        // 표가 아직 없는 DB
      }
    }),
  );
}
