// 2군 성장 퀘스트 (개발중, 제작자 2026-11-09 '2군 인원들에게 성장지원을 해줄거야, 웹에서 퀘스트 식으로, 렙업마다 보상, 공평하게 1렙업마다 계산해서'):
// 2군 캐릭터마다 정해진 목표 레벨까지 레벨을 올리면 레벨 하나마다 정해진 골드가 쌓인다 (높은 레벨일수록 1레벨이 어려워 더 많이, 오피서가 조정할 수 있다).
// '보상받기 신청'을 누르면 오피서에게 알림이 가고, 게임 안에서 실제로 주고받은 뒤 오피서가 '지급 완료'를 누른다 (장비대여 신청/장비대여 완료와 같은 흐름).
// 레벨은 게임을 읽지 않고 본인이 적어 둔 profiles.level(길드 랭킹과 같은 자료)만 본다. 화면: src/pages/Quest2.tsx, src/quest2.ts. API: functions/api/quest2
//
// 격주로 새 라운드를 연다 (제작자 요청): 오피서가 새 목표 목록으로 라운드를 열면 이전 라운드는 active=0 이 되어 목록에서 접히고(기록은 남는다),
// 그 라운드의 신청·지급 기록은 그대로 둔다. 목표(quest2_targets)는 오피서가 추가·수정·삭제할 수 있어 코드를 고치지 않고도 다음 라운드를 만들 수 있다.
import type { Env, User } from "./auth";
import { TEST_IDS } from "./auth";
import { text } from "./requests";
import { notify } from "./alerts";

export { text };

/** 길드원에게 열기 전에는 앱개발자(와 테스트 계정)만 (제작자 2026-11-09 '일단 나만 보이게 해줘야해'). 화면 launcher.ts 의 canQuest2, App.tsx 도 같이.
 *  열 때는 QUEST2_OPEN 을 true 로 (CLAUDE.md '2군 성장 퀘스트' 참고) */
export const QUEST2_OPEN = false;
export const canUseQuest2 = (me: User) => QUEST2_OPEN || me.role === "developer" || TEST_IDS.includes(me.id);
/** 라운드·목표·보상 곡선을 다루고 신청을 처리할 수 있는 사람 (오피서 이상). RANK 는 auth.ts 에서 따로 쓴다 */
export const canManageQuest2 = (role: User["role"]) => role === "developer" || role === "master" || role === "officer";

export const MAX_NICK = 20;
export const MAX_TITLE = 40;
export const MAX_NOTE = 80;
export const MAX_TARGETS_PER_ROUND = 60;
export const MAX_LEVEL = 99;

export const validLevel = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_LEVEL;

/** 보상 레벨대 (기본값, 오피서가 조정할 수 있다): 레벨이 높을수록 1레벨 올리기가 힘들어서 더 많이 준다.
 *  30~35 구간을 2연업 기준 6만 골드(원래 글의 '6만골드어치')에 맞췄다: 2 x 30,000 = 60,000 */
export const DEFAULT_BANDS: { minLevel: number; goldPerLevel: number }[] = [
  { minLevel: 1, goldPerLevel: 10_000 },
  { minLevel: 30, goldPerLevel: 30_000 },
  { minLevel: 36, goldPerLevel: 35_000 },
  { minLevel: 40, goldPerLevel: 40_000 },
];

/** 참고용 보상 아이템 (제작자가 알려 준 골드 값. 실제로는 오피서가 이 값 안에서 자유롭게 골라 게임 안에서 준다) */
export const REWARD_ITEMS: { name: string; unit: string; gold: number }[] = [
  { name: "사나운 멧돼지", unit: "20개", gold: 120_000 },
  { name: "자몽주스", unit: "1개", gold: 60_000 },
  { name: "자몽케이크", unit: "1개", gold: 80_000 },
  { name: "망고워터", unit: "20개", gold: 35_000 },
];

export interface Band {
  minLevel: number;
  goldPerLevel: number;
}

/** 그 레벨에 올라서는 데 주는 골드 (band 는 min_level 내림차순으로 미리 정렬해 둔다) */
function goldForLevel(level: number, bands: Band[]): number {
  for (const b of bands) if (level >= b.minLevel) return b.goldPerLevel;
  return bands.length ? bands[bands.length - 1].goldPerLevel : 0;
}

/** from(안 셈) + 1 부터 to 까지 올린 만큼의 골드 합. to 가 from 보다 낮거나 같으면 0 */
export function levelReward(from: number, to: number, bands: Band[]): number {
  const sorted = [...bands].sort((a, b) => b.minLevel - a.minLevel);
  let sum = 0;
  for (let lv = from + 1; lv <= to; lv++) sum += goldForLevel(lv, sorted);
  return sum;
}

/** 레벨 하나씩의 보상 내역 (화면의 '자세히' 표) */
export function rewardLedger(from: number, to: number, bands: Band[]): { level: number; gold: number }[] {
  const sorted = [...bands].sort((a, b) => b.minLevel - a.minLevel);
  const rows: { level: number; gold: number }[] = [];
  for (let lv = from + 1; lv <= to; lv++) rows.push({ level: lv, gold: goldForLevel(lv, sorted) });
  return rows;
}

export async function readBands(env: Env): Promise<Band[]> {
  const { results } = await env.DB.prepare("SELECT min_level AS minLevel, gold_per_level AS goldPerLevel FROM quest2_bands ORDER BY min_level ASC").all<Band>();
  return results.length ? results : DEFAULT_BANDS;
}

export function readNick(v: unknown): string | null {
  const t = text(v, MAX_NICK);
  return t === undefined ? null : t;
}

/** 목표 올리기·고치기 입력 검사 */
export function readTargetInput(b: { nickname?: unknown; startLevel?: unknown; endLevel?: unknown; note?: unknown }):
  | { nickname: string; startLevel: number; endLevel: number; note: string | null }
  | string {
  const nickname = readNick(b.nickname);
  if (!nickname) return `닉네임을 ${MAX_NICK}자 안으로 적어 주세요`;
  if (!validLevel(b.startLevel) || !validLevel(b.endLevel)) return "레벨이 맞지 않아요";
  if ((b.endLevel as number) < (b.startLevel as number)) return "목표 레벨이 시작 레벨보다 낮아요";
  const note = text(b.note, MAX_NOTE);
  if (note === undefined) return `쪽지는 ${MAX_NOTE}자까지예요`;
  return { nickname, startLevel: b.startLevel as number, endLevel: b.endLevel as number, note };
}

/** 라운드 열기 입력 검사 (목표 목록까지 한 번에) */
export function readRoundInput(b: { title?: unknown; note?: unknown; targets?: unknown }):
  | { title: string; note: string | null; targets: { nickname: string; startLevel: number; endLevel: number; note: string | null }[] }
  | string {
  const title = text(b.title, MAX_TITLE);
  if (!title) return `라운드 이름을 ${MAX_TITLE}자 안으로 적어 주세요`;
  const note = text(b.note, MAX_NOTE);
  if (note === undefined) return `쪽지는 ${MAX_NOTE}자까지예요`;
  if (!Array.isArray(b.targets) || !b.targets.length) return "목표를 하나 이상 넣어 주세요";
  if (b.targets.length > MAX_TARGETS_PER_ROUND) return `목표는 ${MAX_TARGETS_PER_ROUND}개까지예요`;
  const targets: { nickname: string; startLevel: number; endLevel: number; note: string | null }[] = [];
  for (const raw of b.targets as Record<string, unknown>[]) {
    const t = readTargetInput(raw ?? {});
    if (typeof t === "string") return t;
    targets.push(t);
  }
  return { title, note, targets };
}

export function readBandsInput(b: { bands?: unknown }): Band[] | string {
  if (!Array.isArray(b.bands) || !b.bands.length) return "레벨대를 하나 이상 넣어 주세요";
  if (b.bands.length > 20) return "레벨대는 20개까지예요";
  const bands: Band[] = [];
  const seen = new Set<number>();
  for (const raw of b.bands as Record<string, unknown>[]) {
    const minLevel = Number(raw?.minLevel);
    const goldPerLevel = Number(raw?.goldPerLevel);
    if (!validLevel(minLevel)) return "레벨대의 시작 레벨이 맞지 않아요";
    if (!Number.isInteger(goldPerLevel) || goldPerLevel < 0 || goldPerLevel > 10_000_000) return "레벨대의 골드가 맞지 않아요";
    if (seen.has(minLevel)) return "같은 시작 레벨이 두 번 있어요";
    seen.add(minLevel);
    bands.push({ minLevel, goldPerLevel });
  }
  return bands.sort((a, b) => a.minLevel - b.minLevel);
}

export interface TargetRow {
  id: number;
  round_id: number;
  nickname: string;
  start_level: number;
  end_level: number;
  note: string | null;
  paid_to_level: number;
  created_at: number;
  updated_at: number;
}

export interface ClaimRow {
  id: number;
  target_id: number;
  user_id: string;
  from_level: number;
  to_level: number;
  gold: number;
  doping: number;
  note: string | null;
  status: "pending" | "paid" | "rejected";
  requested_at: number;
  paid_at: number | null;
  paid_by: string | null;
}

/** 캐릭터가 올린 신청이 지급·거절되지 않고 남아 있는지 */
export const isPending = (c: Pick<ClaimRow, "status">) => c.status === "pending";

/** 지금 열려 있는 라운드 (없으면 null) */
export async function activeRound(env: Env) {
  return env.DB.prepare("SELECT id, title, note, starts_at AS startsAt, ends_at AS endsAt FROM quest2_rounds WHERE active = 1 ORDER BY id DESC LIMIT 1").first<{
    id: number;
    title: string;
    note: string | null;
    startsAt: number;
    endsAt: number | null;
  }>();
}

/** 그 닉네임(캐릭터)이 적어 둔 지금 레벨 (앱 계정이 없으면 null) */
export async function levelOf(env: Env, nickname: string): Promise<number | null> {
  const r = await env.DB.prepare("SELECT level FROM profiles WHERE user_id = ?").bind(nickname).first<{ level: number }>();
  return r?.level ?? null;
}

/** 운영(오피서 이상)에게 알림. 열기 전에는 앱개발자에게만 (나만 보이는 동안 오피서를 혼란스럽게 하지 않으려고) */
export async function notifyOfficers(env: Env, msg: string, from: string): Promise<void> {
  const where = QUEST2_OPEN ? "role IN ('officer', 'master', 'developer')" : "role = 'developer'";
  const { results } = await env.DB.prepare(`SELECT DISTINCT COALESCE(main_id, id) AS id FROM users WHERE ${where}`).all<{ id: string }>();
  await notify(env, results.map((r) => r.id), "quest2", msg, "#/quest2?v=staff", from);
}
