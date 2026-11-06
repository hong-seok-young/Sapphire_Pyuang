// To do (제작자 요청 2026-11-01): 이벤트를 안 읽어도 본인 직업·레벨에 맞는 할 일. 서버는 공식 글에서 뽑아 둔 이벤트 할 일(official_todo)과
// 체크한 것(todo_checks)을 준다. 길드 출석·길드 임무·인던 같은 늘 하는 일은 화면이 위키 자료로 만든다 (src/todo.ts).
// 체크는 그 주기 안에서만 남는다: 매일(d)은 한국 시간 0시, 매주(w)는 목요일 오전 10시(server/week.ts), 한 번(o)은 계속.
// 사용자가 직접 누르는 체크일 뿐 게임은 읽지 않는다 (CLAUDE.md 게임 안전 규칙).
import { TEST_IDS } from "./auth";
import type { Env } from "./auth";
import { weekStart } from "./week";
import { DIGEST_TAG, NO_TODO_TITLE, digestClient, digestPost, digestStale, mergeSignature, mergeTasks, signatureSources, tasksUntil } from "./todoDigest";
import type { DigestOfPost, TodoTask } from "./todoDigest";
import type Anthropic from "@anthropic-ai/sdk";
import { RICH_DONE_SQL, RICH_IMG_SQL, richBody } from "./officialImages";

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

/** 할 일 이름표 (체크에 쓴다): 주기, 어디서 온 것(글 번호, 모은 목록이면 m), 할 일 글자의 해시 (다시 정리해도 같은 글자면 체크가 그대로) */
export function taskKey(scope: number | "m", t: TodoTask): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.t.length; i++) {
    h ^= t.t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${t.c}:${scope}:${(h >>> 0).toString(36)}`;
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
  /** 공식 글 (모은 할 일은 그 일을 안내한 가장 새 글) */
  post: { id: number; title: string };
  /** 펼치면 보이는 요약: 게임 안에서 할 것, 기간을 몰라 손해 보는 것 (todoDigest.ts) */
  steps: string[];
  warns: string[];
  /** 게임 밖에서 여는 곳 (응모하는 디스코드·카페·설문, 쿠폰 입력 페이지) */
  link: string | null;
}

/** 지금 할 수 있는 할 일이 남은 글의 정리 (표 official_todo, 글 번호 0 은 모은 목록이라 official_news 와 이어지지 않아 빠진다) */
async function liveDigests(env: Env, now: number): Promise<{ digests: DigestOfPost[]; merged: { tasks: TodoTask[]; src: string } | null }> {
  const [digestsR, mergedR] = await env.DB.batch([
    env.DB.prepare(
      "SELECT t.id, t.tasks, t.made_at, n.title, n.start_date FROM official_todo t JOIN official_news n ON n.id = t.id WHERE t.until > ? ORDER BY t.id DESC LIMIT 80",
    ).bind(now),
    env.DB.prepare("SELECT tasks, src FROM official_todo WHERE id = 0"),
  ]);
  const parse = (s: string): TodoTask[] => {
    try {
      return JSON.parse(s) as TodoTask[];
    } catch {
      return [];
    }
  };
  const digests = (digestsR.results as { id: number; tasks: string; made_at: number; title: string; start_date: string | null }[]).map((r) => ({
    id: r.id,
    title: r.title,
    start_date: r.start_date,
    made_at: r.made_at,
    tasks: parse(r.tasks),
  }));
  const m = mergedR.results[0] as { tasks: string; src: string } | undefined;
  return { digests, merged: m ? { tasks: parse(m.tasks), src: m.src } : null };
}

/** 할 일 하나의 보이는 칸 */
const shown = (t: TodoTask) => ({ text: t.t, note: t.n, cycle: t.c, at: t.at, until: t.e, steps: t.d ?? [], warns: t.w ?? [], link: t.l ?? null });

/**
 * 지금 이 사람에게 보일 이벤트 할 일: 시작했고 안 끝난 것, 정해진 요일이면 오늘인 것, 레벨·직업이 맞는 것.
 * 여러 글에서 겹친 일을 합친 모은 목록(글 번호 0, mergeIfStale)을 쓰고, 모은 뒤에 정리된 글의 할 일은 그대로 붙인다
 */
export async function eventTasks(env: Env, profile: { job: string | null; level: number | null }, now = Date.now()): Promise<TodoItemOut[]> {
  const { digests, merged } = await liveDigests(env, now);
  const today = new Date(now + KST).getUTCDay();
  const keep = (t: TodoTask) => {
    if ((t.s ?? 0) > now || (t.e !== null && t.e <= now)) return false;
    if (t.days?.length && !t.days.includes(today)) return false;
    const [min, max] = t.lv ?? [null, null];
    if (profile.level !== null && ((min !== null && profile.level < min) || (max !== null && profile.level > max))) return false;
    return !(t.jobs?.length && profile.job && !t.jobs.includes(profile.job));
  };
  const madeAt = new Map(digests.map((d) => [d.id, d.made_at]));
  const titleOf = new Map(digests.map((d) => [d.id, d.title]));
  // 모은 목록이 어느 정리로 만든 것인지: 그 뒤에 다시 정리된 글은 모은 목록 대신 그 글의 할 일을 쓴다
  const included = new Map<number, number>(merged ? signatureSources(merged.src) : []);
  const fresh = (id: number) => included.has(id) && included.get(id) === madeAt.get(id);
  const out: TodoItemOut[] = [];
  for (const t of merged?.tasks ?? []) {
    const src = (t.p ?? []).filter(fresh);
    if (src.length && keep(t)) out.push({ ...shown(t), key: taskKey("m", t), post: { id: src[0], title: titleOf.get(src[0]) ?? "" } });
  }
  for (const d of digests) {
    if (merged && fresh(d.id)) continue;
    for (const t of d.tasks) if (keep(t)) out.push({ ...shown(t), key: taskKey(d.id, t), post: { id: d.id, title: d.title } });
  }
  return out;
}

/** 모은 목록이 지금 정리들과 다르면 다시 모은다 (Claude, 겹친 일 합치기). 거절당하면 그대로 둔다 (글마다 뽑은 것이 보인다) */
export async function mergeIfStale(env: Env, client: Anthropic, now = Date.now()): Promise<boolean> {
  const { digests, merged } = await liveDigests(env, now);
  const sig = mergeSignature(digests, now);
  if (merged?.src === sig) return false;
  const tasks = await mergeTasks(client, digests, now);
  if (tasks === null) return false;
  await env.DB.prepare(SAVE_TODO_SQL).bind(0, sig, JSON.stringify(tasks), tasksUntil(tasks, kstDate(now)), Date.now(), DIGEST_TAG).run();
  return true;
}

/** 정리할 글 (서버 몫: 최근 30일). 원문이 바뀌었거나 아직 안 했고, 다른 곳이 맡은 지 10분이 안 된 것은 뺀다 */
export function pendingSql(withBody: boolean) {
  const cols = withBody ? "n.id, n.kind, n.type, n.title, n.start_date, n.src" : "n.id, n.title, t.claimed_at";
  const stale = digestStale(RICH_DONE_SQL);
  return (
    `SELECT ${cols} FROM official_news n LEFT JOIN official_todo t ON t.id = n.id ` +
    `WHERE n.kind = 'event' AND n.start_date >= ?1 AND ${stale} ` +
    `UNION ALL SELECT ${cols} FROM official_news n LEFT JOIN official_todo t ON t.id = n.id ` +
    `WHERE n.kind = 'notice' AND n.start_date >= ?1 AND n.type IN ('N', 'I') AND ${stale}`
  );
}

/** 맡은 글의 본문: 글자 + 그림 속 글자 (제작자 2026-11-06 '시너지 다 하자'). complete: 그림을 다 옮겼는지 */
async function postBody(env: Env, id: number): Promise<{ body: string; html: string | null; complete: boolean }> {
  const [news, rich, imgs] = await Promise.all([
    env.DB.prepare("SELECT body, html FROM official_news WHERE id = ?").bind(id).first<{ body: string | null; html: string | null }>(),
    env.DB.prepare("SELECT text, keys FROM official_rich WHERE id = ?").bind(id).first<{ text: string | null; keys: string | null }>(),
    env.DB.prepare(RICH_IMG_SQL).bind(id).all<{ key: string; text: string }>(),
  ]);
  const r = richBody(news?.body ?? "", rich, new Map(imgs.results.map((g) => [g.key, g.text])));
  return { ...r, html: news?.html ?? null };
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
  const client = digestClient(env.ANTHROPIC_API_KEY, env.ANTHROPIC_WORKSPACE_ID);
  if (!picked.length) {
    // 정리할 글은 없어도 모은 목록이 예전 것이면 다시 모은다
    await mergeIfStale(env, client, now).catch((e) => console.error("todo merge failed", e instanceof Error ? e.message.slice(0, 200) : e));
    return 0;
  }
  await Promise.all(
    picked.map(async (p) => {
      try {
        const full = await postBody(env, p.id);
        const tasks = NO_TODO_TITLE.test(p.title) ? [] : await digestPost(client, { ...p, body: full.body, html: full.html });
        // 그림을 다 옮기기 전이면 판 끝에 p: 그림이 다 옮겨지면 다시 정리한다 (digestStale)
        await env.DB.prepare(SAVE_TODO_SQL)
          .bind(p.id, p.src, JSON.stringify(tasks), tasksUntil(tasks, p.start_date), Date.now(), full.complete ? DIGEST_TAG : DIGEST_TAG + "p")
          .run();
      } catch (e) {
        // 맡은 채로 두면 10분 뒤 다시 한다
        console.error("todo digest failed", p.id, e instanceof Error ? e.message.slice(0, 200) : e);
      }
    }),
  );
  // 겹친 일을 다시 합친다 (새 글의 할 일이 이미 있는 이벤트를 다시 안내한 것일 수 있다)
  await mergeIfStale(env, client).catch((e) => console.error("todo merge failed", e instanceof Error ? e.message.slice(0, 200) : e));
  return picked.length;
}

/** 체크한 것 (지금 주기의 것만) */
export async function doneKeys(env: Env, userId: string, now = Date.now()): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT item FROM todo_checks WHERE user_id = ? AND period IN (?, ?, 'o')")
    .bind(userId, "d" + kstDate(now), "w" + kstDate(weekStart(now)))
    .all<{ item: string }>();
  return results.map((r) => r.item);
}

// ---------- 사람마다 고친 To do: 내 할 일, 숨기기·이름 고치기, 함께 하는 할 일 (제작자 요청 2026-11-02) ----------

/** 길드원에게 열었는지 (2026-11-02 열었다, 제작자 요청 '투두도 오픈'). 열기 전에는 운영진, 앱개발자, 테스트 계정만 쓰고 함께 할 사람도 그 안에서만 골랐다 */
export const TODO_OPEN = true;
/** 할 일 키: 주기(d 매일, w 매주, o 한 번):무엇 */
export const TODO_KEY = /^[dwo]:[\p{L}\p{N}:_-]{1,80}$/u;
/** 내 할 일의 키 */
export const customKey = (cycle: string, id: number) => `${cycle}:c:${id}`;
export const isCustomKey = (key: string) => /^[dwo]:c:\d+$/.test(key);
export const MAX_CUSTOM = 30;
export const MAX_SHARE_MEMBERS = 20;
export const MAX_SHARES = 30;

/** 글자 칸: 공백을 하나로, max 자까지 (빈 글은 null) */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
}

export interface TodoCustomOut {
  id: number;
  key: string;
  cycle: "d" | "w" | "o";
  text: string;
  note: string | null;
}
export interface TodoEditOut {
  key: string;
  hidden: boolean;
  text: string | null;
  note: string | null;
}
export interface TodoShareOut {
  id: number;
  owner: string;
  key: string;
  text: string;
  note: string | null;
  at: string | null;
  /** 함께 하는 사람 (만든 사람 먼저)과 지금 주기에 체크했는지 */
  members: { id: string; done: boolean }[];
}

/** 이 캐릭터의 내 할 일, 고친 것, 함께 하는 할 일 (함께 하는 사람들의 체크까지) */
export async function todoExtras(env: Env, userId: string, now = Date.now()): Promise<{ custom: TodoCustomOut[]; edits: TodoEditOut[]; shares: TodoShareOut[] }> {
  const mine = "SELECT share_id FROM todo_share_members WHERE user_id = ?1";
  const [customR, editsR, sharesR, membersR, checksR] = await env.DB.batch([
    env.DB.prepare("SELECT id, cycle, text, note FROM todo_custom WHERE user_id = ?1 ORDER BY id").bind(userId),
    env.DB.prepare("SELECT item, hidden, text, note FROM todo_edits WHERE user_id = ?1").bind(userId),
    env.DB.prepare(`SELECT id, owner, item, text, note, at_text FROM todo_shares WHERE id IN (${mine}) ORDER BY id`).bind(userId),
    env.DB.prepare(`SELECT share_id, user_id FROM todo_share_members WHERE share_id IN (${mine}) ORDER BY added_at, user_id`).bind(userId),
    env.DB.prepare(
      "SELECT m.share_id, c.user_id FROM todo_share_members m JOIN todo_shares s ON s.id = m.share_id " +
        `JOIN todo_checks c ON c.user_id = m.user_id AND c.item = s.item WHERE m.share_id IN (${mine}) AND c.period IN (?2, ?3, 'o')`,
    ).bind(userId, "d" + kstDate(now), "w" + kstDate(weekStart(now))),
  ]);
  const custom = (customR.results as { id: number; cycle: "d" | "w" | "o"; text: string; note: string | null }[]).map((r) => ({
    ...r,
    key: customKey(r.cycle, r.id),
  }));
  const edits = (editsR.results as { item: string; hidden: number; text: string | null; note: string | null }[]).map((r) => ({
    key: r.item,
    hidden: !!r.hidden,
    text: r.text,
    note: r.note,
  }));
  const done = new Set((checksR.results as { share_id: number; user_id: string }[]).map((r) => `${r.share_id}\n${r.user_id}`));
  const members = new Map<number, string[]>();
  for (const r of membersR.results as { share_id: number; user_id: string }[]) members.set(r.share_id, [...(members.get(r.share_id) ?? []), r.user_id]);
  const shares = (sharesR.results as { id: number; owner: string; item: string; text: string; note: string | null; at_text: string | null }[]).map((s) => {
    const ids = members.get(s.id) ?? [];
    const ordered = [s.owner, ...ids.filter((id) => id !== s.owner)];
    return {
      id: s.id,
      owner: s.owner,
      key: s.item,
      text: s.text,
      note: s.note,
      at: s.at_text,
      members: ordered.map((id) => ({ id, done: done.has(`${s.id}\n${id}`) })),
    };
  });
  return { custom, edits, shares };
}

/** 함께 할 수 있는 사람인지 (열기 전에는 미리 보는 사람만: 운영진, 앱개발자, 테스트 계정. 화면 src/launcher.ts canPreview) */
export async function shareablePeople(env: Env, exclude: string): Promise<{ id: string; job: string | null; level: number | null; guild: string | null }[]> {
  const only = TODO_OPEN ? "" : ` AND (u.role IN ('developer', 'master', 'officer') OR u.id IN (${TEST_IDS.map((id) => `'${id}'`).join(", ")}))`;
  const { results } = await env.DB.prepare(
    "SELECT u.id, p.job, p.level, p.guild FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id != ?" + only + " ORDER BY p.level DESC, u.id LIMIT 500",
  )
    .bind(exclude)
    .all<{ id: string; job: string | null; level: number | null; guild: string | null }>();
  return results;
}
