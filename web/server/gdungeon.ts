// 길드 던전 (제작자 요청 2026-11-02): 4인 파티(예: 유어아너, 폰, 후꾹, 퓨앙)가 한 주에 한 번 함께 갈 때를 정한다. 1군 전용.
//  - 한 주는 목요일 10시부터 다음 주 목요일 10시까지 (server/week.ts weekStart, 다른 주간 기능과 같다).
//  - 각자 이번 주 가능한 때를 시간표(하루 09:00 ~ 다음 날 02:00, 30분 칸)에 칠한다 (gd_avail, 사람마다 한 주 한 줄).
//  - 파티원이 모두 칠하면 모두 되는 30분 칸이 후보가 된다. 가장 빠른 때부터 1번, 2번 … 후보.
//  - 지금 후보(가장 빠른, 무산되지 않은)에 각자 '확정'이나 '불참'을 누른다. 모두 확정하면 그때로 정해지고 알림이 간다.
//    한 사람이라도 불참하면 그 후보는 무산되고 다음 후보로 넘어간다 (제작자 요청: '아 이때 안 돼요! 불참 누르면 무산되고 2번 후보로', 투표는 하지 않는다).
//  - 정한 뒤에도 일이 생기면 불참을 누를 수 있다: 파티원에게 알리고 다음 후보로 넘어간다 (제작자 요청 2026-11-02).
// 게임을 읽지 않고 사람이 직접 적는 시간표라 게임 안전 규칙에 맞는다.
import type { Env, User } from "./auth";
import { RANK, TEST_IDS } from "./auth";
import { notify } from "./alerts";
import { WEEK, weekStart } from "./week";

export const SLOT_MS = 30 * 60_000;
/** 한 주의 30분 칸 수 (목 10:00 부터) */
export const SLOTS = 336;
/** 하루 칸 수: 09:00 ~ 다음 날 02:00 */
export const ROWS = 34;
export const MAX_MEMBERS = 4;
const DAY = 86_400_000;
const KST = 9 * 3_600_000;

/** 시간표에 있는 칸인지: 하루는 09:00(주 시작 10:00 보다 2칸 앞)부터 34칸 */
export const validSlot = (i: number) => Number.isInteger(i) && i >= 0 && i < SLOTS && (i + 2) % 48 < ROWS && Math.floor((i + 2) / 48) < 7;

/** '0'/'1' 336자 (시간표에 없는 칸은 0) */
export function cleanBits(v: unknown): string | null {
  if (typeof v !== "string" || v.length !== SLOTS || !/^[01]+$/.test(v)) return null;
  let out = "";
  for (let i = 0; i < SLOTS; i++) out += v[i] === "1" && validSlot(i) ? "1" : "0";
  return out;
}

/** '11/7(금) 21:00' (한국 시간) */
export function slotText(week: number, i: number): string {
  const d = new Date(week + i * SLOT_MS + KST);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${"일월화수목금토"[d.getUTCDay()]}) ${hm}`;
}

/** 파티 명단을 모두에게 보이는지 (제작자 2026-11-03: '파티명단 아직 미정이니까 공지 후 반영할게, 일단 파티 목록 안 보이게 해 놔').
 *  false 면 길드원은 내 시간표만 칠하고(파티가 열리면 바로 후보가 나오게), 내 파티·후보·다른 파티·파티 만들기는 길드마스터와 앱개발자만 미리 본다
 *  (제작자 2026-11-03 '공지 전 숨기기는 길마와 나만': 오피서와 테스트 계정도 길드원과 같이 숨긴다. canSeeParties, 화면 src/gdungeon.ts 의 hidden).
 *  제작자가 공지한 뒤 true 로 바꾼다 (화면·챗봇·알림이 같이 열린다). */
export const GD_PARTIES_OPEN = false;
export const canSeeParties = (me: User) => GD_PARTIES_OPEN || RANK[me.role] >= 2;

/** 들어올 수 있는지: 1군 (앱개발자는 시험하려고 길드와 상관없이) */
export async function canUseGd(env: Env, me: User): Promise<boolean> {
  if (me.role === "developer") return true;
  const p = await env.DB.prepare("SELECT guild FROM profiles WHERE user_id = ?").bind(me.id).first<{ guild: string | null }>();
  return p?.guild === "main";
}

/** 파티 이름은 파티장 닉네임으로 'OO 팀' (제작자 요청 2026-11-02: '파티장 이름으로, 팀 이름 유어아너 팀'). 파티장이 바뀌면 같이 바뀐다 */
export const teamName = (leader: string) => `${leader} 팀`;
/** 길드던전 단계 (제작자 2026-11-03: 파티마다 1~4단계처럼 도는 단계가 있다. 여유 있게 9까지) */
export const MAX_STAGE = 9;
export const readStage = (v: unknown): number | null | undefined =>
  v === null ? null : typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_STAGE ? v : undefined;

/** 파티를 다룰 수 있는지: 파티장 또는 운영진(오피서 이상) */
export const canManageParty = (me: User, leader: string) => me.id === leader || RANK[me.role] >= 1;

export interface Answer {
  slot: number;
  user: string;
  answer: "yes" | "no";
}
export interface PartyState {
  id: number;
  name: string;
  leader: string;
  /** 길드던전 단계 (없으면 null) */
  stage: number | null;
  members: { id: string; filled: boolean }[];
  /** 파티원의 이번 주 가능한 때 ('0'/'1' 336자, 안 칠한 사람은 없다) */
  avail: Record<string, string>;
  /** 모두 되는 칸 (지난 칸은 정해진 것만), 빠른 순 */
  candidates: number[];
  /** 무산된 후보와 불참한 사람 */
  rejected: { slot: number; by: string[] }[];
  /** 지금 확정·불참을 받는 후보 (없으면 null) */
  current: number | null;
  /** 지금 후보에 확정한 사람 */
  yes: string[];
  /** 모두 확정한 때 */
  confirmed: number | null;
}

/** 파티 하나의 이번 주 상태 */
export function partyState(
  p: { id: number; name: string; leader: string; stage?: number | null },
  memberIds: string[],
  availRows: Map<string, string>,
  answers: Answer[],
  week: number,
  now: number,
): PartyState {
  const members = memberIds.map((id) => ({ id, filled: availRows.has(id) }));
  const avail: Record<string, string> = {};
  for (const m of members) if (availRows.has(m.id)) avail[m.id] = availRows.get(m.id)!;
  const all = members.length > 0 && members.every((m) => m.filled);
  const mine = answers.filter((a) => a.answer && memberIds.includes(a.user));
  const noBy = new Map<number, string[]>();
  const yesBy = new Map<number, string[]>();
  for (const a of mine) {
    const m = a.answer === "no" ? noBy : yesBy;
    m.set(a.slot, [...(m.get(a.slot) ?? []), a.user]);
  }
  const candidates: number[] = [];
  let current: number | null = null;
  let confirmed: number | null = null;
  if (all) {
    for (let i = 0; i < SLOTS; i++) {
      if (!validSlot(i) || !memberIds.every((id) => avail[id][i] === "1")) continue;
      const done = !noBy.has(i) && memberIds.every((id) => yesBy.get(i)?.includes(id));
      const past = week + i * SLOT_MS <= now;
      // 지난 칸은 정해졌던 것만 남긴다 (정한 때가 지나도 '이번 주는 …'이 그대로 보이게)
      if (past && !done) continue;
      candidates.push(i);
      if (current !== null || confirmed !== null || noBy.has(i)) continue;
      if (done) confirmed = i;
      else current = i;
    }
  }
  return {
    id: p.id,
    name: teamName(p.leader),
    leader: p.leader,
    stage: p.stage ?? null,
    members,
    avail,
    candidates,
    rejected: candidates.filter((s) => noBy.has(s)).map((slot) => ({ slot, by: noBy.get(slot)! })),
    current,
    yes: current !== null ? (yesBy.get(current) ?? []).filter((id) => memberIds.includes(id)) : [],
    confirmed,
  };
}

/** 이번 주 모든 파티의 상태 (파티는 많아야 수십 개라 한꺼번에 읽어 계산한다) */
export async function allParties(env: Env, week: number, now = Date.now()): Promise<PartyState[]> {
  const [parties, members, avail, answers] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, leader, stage FROM gd_parties ORDER BY id"),
    env.DB.prepare("SELECT party_id, user_id FROM gd_members ORDER BY joined_at, user_id"),
    env.DB.prepare("SELECT user_id, slots FROM gd_avail WHERE week = ?").bind(week),
    env.DB.prepare("SELECT party_id, slot, user_id AS user, answer FROM gd_answers WHERE week = ?").bind(week),
  ]);
  const byParty = new Map<number, string[]>();
  for (const m of members.results as { party_id: number; user_id: string }[]) byParty.set(m.party_id, [...(byParty.get(m.party_id) ?? []), m.user_id]);
  const availOf = new Map((avail.results as { user_id: string; slots: string }[]).map((r) => [r.user_id, r.slots]));
  const ans = answers.results as (Answer & { party_id: number })[];
  return (parties.results as { id: number; name: string; leader: string; stage: number | null }[]).map((p) => {
    // 파티장이 맨 앞
    const ids = byParty.get(p.id) ?? [];
    const ordered = [p.leader, ...ids.filter((id) => id !== p.leader)].filter((id) => ids.includes(id));
    return partyState(p, ordered, availOf, ans.filter((a) => a.party_id === p.id), week, now);
  });
}

export async function partyIdOf(env: Env, userId: string): Promise<number | null> {
  const r = await env.DB.prepare("SELECT party_id FROM gd_members WHERE user_id = ?").bind(userId).first<{ party_id: number }>();
  return r?.party_id ?? null;
}

export async function oneParty(env: Env, partyId: number, week: number, now = Date.now()): Promise<PartyState | null> {
  return (await allParties(env, week, now)).find((p) => p.id === partyId) ?? null;
}

/** 파티에 넣을 수 있는 사람 (1군. 테스트 계정은 앱개발자·테스트 계정에게만 보인다) */
export async function gdPeople(env: Env, me: User): Promise<{ id: string; job: string | null; level: number | null; party: number | null }[]> {
  const { results } = await env.DB.prepare(
    "SELECT u.id AS id, p.job AS job, p.level AS level, m.party_id AS party FROM users u JOIN profiles p ON p.user_id = u.id " +
      "LEFT JOIN gd_members m ON m.user_id = u.id WHERE p.guild = 'main' ORDER BY p.level DESC, u.id LIMIT 300",
  ).all<{ id: string; job: string | null; level: number | null; party: number | null }>();
  const tester = me.role === "developer" || TEST_IDS.includes(me.id);
  return results.filter((r) => tester || !TEST_IDS.includes(r.id));
}

/** 넣으려는 사람들이 1군이고 다른 파티에 없는지 (없으면 null, 있으면 까닭) */
export async function memberProblem(env: Env, ids: string[], partyId: number | null): Promise<string | null> {
  if (!ids.length) return null;
  const { results } = await env.DB.prepare(
    `SELECT u.id AS id, p.guild AS guild, m.party_id AS party FROM users u LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN gd_members m ON m.user_id = u.id WHERE u.id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(...ids)
    .all<{ id: string; guild: string | null; party: number | null }>();
  for (const id of ids) {
    const r = results.find((x) => x.id === id);
    if (!r) return `${id}: 없는 아이디예요`;
    if (r.guild !== "main" && !TEST_IDS.includes(id)) return `${id} 님은 1군이 아니에요`;
    if (r.party !== null && r.party !== partyId) return `${id} 님은 이미 다른 파티에 있어요`;
  }
  return null;
}

/** 파티원에게 알림 (나 빼고) */
export async function tellParty(env: Env, p: PartyState, text: string, from: string): Promise<void> {
  let to = p.members.map((m) => m.id).filter((id) => id !== from);
  // 명단을 숨긴 동안은 파티 알림('[향단 팀] 시간표가 다 모였어요')도 미리 보는 사람에게만 (길드원에게 가면 명단이 새 나간다)
  if (!GD_PARTIES_OPEN && to.length) {
    const { results } = await env.DB.prepare(`SELECT id, role FROM users WHERE id IN (${to.map(() => "?").join(",")})`).bind(...to).all<{ id: string; role: User["role"] }>();
    to = results.filter((u) => RANK[u.role] >= 2).map((u) => u.id);
  }
  await notify(env, to, "gdungeon", text, "#/match", from);
}

/** 후보 번호 (빠른 순 1부터, 무산된 것도 번호를 센다) */
export const candidateNo = (p: PartyState, slot: number) => p.candidates.indexOf(slot) + 1;

/** 이번 주와 지난주 */
export function weeks(now = Date.now()) {
  const week = weekStart(now);
  return { week, prev: week - WEEK, end: week + WEEK, day: DAY };
}
