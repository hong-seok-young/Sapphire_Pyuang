// To do (제작자 요청 2026-11-01): 이벤트를 안 읽어도 본인 직업·레벨에 맞는 할 일. 서버는 공식 글에서 뽑아 둔 이벤트 할 일(official_todo)과
// 체크한 것(todo_checks)을 준다. 길드 출석·길드 임무·인던 같은 늘 하는 일은 화면이 위키 자료로 만든다 (src/todo.ts).
// 체크는 그 주기 안에서만 남는다: 매일(d)은 한국 시간 0시, 매주(w)는 목요일 오전 10시(server/week.ts), 한 번(o)은 계속.
// 사용자가 직접 누르는 체크일 뿐 게임은 읽지 않는다 (CLAUDE.md 게임 안전 규칙).
import type { Env } from "./auth";
import { weekStart } from "./week";
import { DIGEST_MODEL, NO_TODO_TITLE, digestClient, digestPost, tasksUntil } from "./todoDigest";
import type { TodoTask } from "./todoDigest";

const DAY = 86_400_000;
const KST = 9 * 3_600_000;
/** 정리를 맡은 지 이만큼 지나도 끝나지 않으면 다른 곳이 다시 맡는다 */
export const CLAIM_MS = 10 * 60_000;
/** 서버가 직접 정리하는 글: 최근 30일 (그 앞은 GitHub Actions 가 한다, scripts/digest-official.mjs) */
const SERVER_DAYS = 30;

/** 한국 시간 날짜 'YYYY-MM-DD' */
export const kstDate = (ms: number) => new Date(ms + KST).toISOString().slice(0, 10);
/** 체크가 남는 주기: d 오늘, w 이번 주, o 계속 */
export function periodOf(key: string, now = Date.now()): string | null {
  if (key.startsWith("d:")) return "d" + kstDate(now);
  if (key.startsWith("w:")) return "w" + kstDate(weekStart(now));
  if (key.startsWith("o:")) return "o";
  return null;
}
/** 다음 0시 (한국 시간) */
export const dayEnd = (now = Date.now()) => now - ((now + KST) % DAY) + DAY;

/** 할 일 이름표 (체크에 쓴다): 주기, 글 번호, 할 일 글자의 해시 (다시 정리해도 같은 글자면 체크가 그대로) */
export function taskKey(postId: number, t: TodoTask): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.t.length; i++) {
    h ^= t.t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${t.c}:${postId}:${(h >>> 0).toString(36)}`;
}

/** 화면에 보낼 이벤트 할 일 */
export interface TodoItemOut {
  key: string;
  text: string;
  note: string | null;
  cycle: "d" | "w" | "o";
  /** 정해진 시각 (오늘 열리는 일) */
  at: string | null;
  /** 끝나는 때 (ms) */
  until: number | null;
  /** 공식 글 */
  post: { id: number; title: string };
}

/** 지금 이 사람에게 보일 이벤트 할 일: 시작했고 안 끝난 것, 정해진 요일이면 오늘인 것, 레벨·직업이 맞는 것 */
export async function eventTasks(env: Env, profile: { job: string | null; level: number | null }, now = Date.now()): Promise<TodoItemOut[]> {
  const { results } = await env.DB.prepare(
    "SELECT t.id, t.tasks, n.title FROM official_todo t JOIN official_news n ON n.id = t.id WHERE t.until > ? ORDER BY t.id DESC LIMIT 60",
  )
    .bind(now)
    .all<{ id: number; tasks: string; title: string }>();
  const today = new Date(now + KST).getUTCDay();
  const out: TodoItemOut[] = [];
  for (const r of results) {
    let tasks: TodoTask[] = [];
    try {
      tasks = JSON.parse(r.tasks) as TodoTask[];
    } catch {
      continue;
    }
    for (const t of tasks) {
      if ((t.s ?? 0) > now || (t.e !== null && t.e <= now)) continue;
      if (t.days?.length && !t.days.includes(today)) continue;
      const [min, max] = t.lv ?? [null, null];
      if (profile.level !== null && ((min !== null && profile.level < min) || (max !== null && profile.level > max))) continue;
      if (t.jobs?.length && profile.job && !t.jobs.includes(profile.job)) continue;
      out.push({ key: taskKey(r.id, t), text: t.t, note: t.n, cycle: t.c, at: t.at, until: t.e, post: { id: r.id, title: r.title } });
    }
  }
  return out;
}

/** 정리할 글 (서버 몫: 최근 30일). 원문이 바뀌었거나 아직 안 했고, 다른 곳이 맡은 지 10분이 안 된 것은 뺀다 */
export function pendingSql(withBody: boolean) {
  const cols = withBody ? "n.id, n.kind, n.type, n.title, n.start_date, n.src, substr(n.body, 1, 20000) AS body" : "n.id, n.title, t.claimed_at";
  const stale = "(t.id IS NULL OR t.made_at = 0 OR substr(t.src, 3) IS NOT substr(n.src, 3))";
  return (
    `SELECT ${cols} FROM official_news n LEFT JOIN official_todo t ON t.id = n.id ` +
    `WHERE n.kind = 'event' AND n.start_date >= ?1 AND ${stale} ` +
    `UNION ALL SELECT ${cols} FROM official_news n LEFT JOIN official_todo t ON t.id = n.id ` +
    `WHERE n.kind = 'notice' AND n.start_date >= ?1 AND n.type IN ('N', 'I') AND ${stale}`
  );
}

/** 아직 정리 안 된 글: pending (맡을 수 있는 것), working (다른 곳이 정리하는 중) */
export async function pendingCount(env: Env, now = Date.now()): Promise<{ pending: number; working: number }> {
  const { results } = await env.DB.prepare(pendingSql(false))
    .bind(kstDate(now - SERVER_DAYS * DAY))
    .all<{ id: number; title: string; claimed_at: number | null }>();
  let pending = 0;
  let working = 0;
  for (const r of results) {
    if (NO_TODO_TITLE.test(r.title)) pending++;
    else if (r.claimed_at && r.claimed_at > now - CLAIM_MS) working++;
    else pending++;
  }
  return { pending, working };
}

interface PendingPost {
  id: number;
  kind: string;
  type: string;
  title: string;
  start_date: string | null;
  src: string | null;
  body: string;
}

/** 표에 정리 결과를 넣는 SQL (?1 id, ?2 src, ?3 tasks, ?4 until, ?5 made_at, ?6 model) */
export const SAVE_TODO_SQL =
  "INSERT INTO official_todo (id, src, tasks, until, made_at, claimed_at, model) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6) " +
  "ON CONFLICT (id) DO UPDATE SET src = excluded.src, tasks = excluded.tasks, until = excluded.until, made_at = excluded.made_at, model = excluded.model";

/**
 * 서버가 정리할 글을 맡아(최근 30일, 새 글부터 max 개) Claude 로 정리해 넣는다. 맡은 수를 돌려준다.
 * 다른 곳(GitHub Actions, 다른 사람의 화면)이 맡은 지 10분이 안 된 글은 건드리지 않는다. API 키가 없으면 하지 않는다
 */
export async function digestPending(env: Env, max = 2, now = Date.now()): Promise<number> {
  if (!env.ANTHROPIC_API_KEY) return 0;
  const { results } = await env.DB.prepare(pendingSql(true) + " ORDER BY 1 DESC LIMIT 20")
    .bind(kstDate(now - SERVER_DAYS * DAY))
    .all<PendingPost>();
  const picked: PendingPost[] = [];
  for (const p of results) {
    if (picked.length >= max) break;
    // 맡기: 없으면 만들고, 있으면 맡은 지 10분이 지났을 때만 (여럿이 같이 와도 하나만)
    const claim = await env.DB.prepare(
      "INSERT INTO official_todo (id, src, tasks, until, made_at, claimed_at) VALUES (?1, NULL, '[]', 0, 0, ?2) " +
        "ON CONFLICT (id) DO UPDATE SET claimed_at = ?2 WHERE COALESCE(official_todo.claimed_at, 0) < ?3",
    )
      .bind(p.id, now, now - CLAIM_MS)
      .run();
    if (claim.meta.changes) picked.push(p);
  }
  if (!picked.length) return 0;
  const client = digestClient(env.ANTHROPIC_API_KEY, env.ANTHROPIC_WORKSPACE_ID);
  await Promise.all(
    picked.map(async (p) => {
      try {
        const tasks = NO_TODO_TITLE.test(p.title) ? [] : await digestPost(client, p);
        await env.DB.prepare(SAVE_TODO_SQL)
          .bind(p.id, p.src, JSON.stringify(tasks), tasksUntil(tasks, p.start_date), Date.now(), DIGEST_MODEL)
          .run();
      } catch (e) {
        // 맡은 채로 두면 10분 뒤 다시 한다
        console.error("todo digest failed", p.id, e instanceof Error ? e.message.slice(0, 200) : e);
      }
    }),
  );
  return picked.length;
}

/** 체크한 것 (지금 주기의 것만) */
export async function doneKeys(env: Env, userId: string, now = Date.now()): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT item FROM todo_checks WHERE user_id = ? AND period IN (?, ?, 'o')")
    .bind(userId, "d" + kstDate(now), "w" + kstDate(weekStart(now)))
    .all<{ item: string }>();
  return results.map((r) => r.item);
}
