// 2군 성장 퀘스트 (개발중, 제작자 2026-11-09 '2군 인원들에게 성장지원을 해줄거야, 웹에서 퀘스트 식으로, 완주하면 보상, 먼저 끝낸 사람은 더 크게'):
// 2군 캐릭터마다 정해진 목표 레벨까지 레벨을 다 올리면(완주) '보상받기 신청'을 할 수 있다. 보상은 골드가 아니라 실제 게임 안 물건(사나운 멧돼지, 망고워터,
// 직업에 맞는 자몽케이크·자몽주스·우파노래 등 날마다·직업마다 다를 수 있어 글로 적는다). 먼저 완주한 몇 명은 더 큰 보상, 나머지 완주자는 보통 보상을 받는다.
// '보상받기 신청'을 누르면 오피서에게 알림이 가고, 게임 안에서 실제로 준 뒤(1~2일 걸릴 수 있다) 오피서가 '지급 완료'를 누른다.
// 레벨은 게임을 읽지 않고 본인이 적어 둔 profiles.level(길드 랭킹과 같은 자료)만 본다. 화면: src/pages/Quest2.tsx, src/quest2.ts. API: functions/api/quest2
//
// 격주로 새 라운드를 연다 (제작자 요청): 오피서가 새 목표 목록과 보상 글로 라운드를 열면 이전 라운드는 active=0 이 되어 목록에서 접히고(기록은 남는다).
// 목표(quest2_targets)는 오피서가 추가·수정·삭제할 수 있어 코드를 고치지 않고도 다음 라운드를 만들 수 있다.
//
// 명단에 없는 2군 길드원을 위한 레벨 구간 참고표(quest2_brackets, 제작자 '20부터 25는 한 구간으로 퉁쳐도 됨', '30부터 어려워짐',
// '38 + 38제무기 +8강부터 1군 편입 고려', '39+ 는 오피서·길마 판단, 대략 44까지'): 신청·지급과는 따로인 안내용 표다.
import type { Env, User } from "./auth";
import { TEST_IDS } from "./auth";
import { text } from "./requests";
import { notify } from "./alerts";

export { text };

/** 길드원에게 열기 전에는 앱개발자(와 테스트 계정)만 (제작자 2026-11-09 '일단 나만 보이게 해줘야해'). 화면 launcher.ts 의 canQuest2, App.tsx 도 같이.
 *  열 때는 QUEST2_OPEN 을 true 로 (CLAUDE.md '2군 성장 퀘스트' 참고) */
export const QUEST2_OPEN = false;
export const canUseQuest2 = (me: User) => QUEST2_OPEN || me.role === "developer" || TEST_IDS.includes(me.id);
/** 라운드·목표·레벨 구간표를 다루고 신청을 처리할 수 있는 사람 (오피서 이상). RANK 는 auth.ts 에서 따로 쓴다 */
export const canManageQuest2 = (role: User["role"]) => role === "developer" || role === "master" || role === "officer";

export const MAX_NICK = 20;
export const MAX_TITLE = 40;
export const MAX_NOTE = 80;
export const MAX_REWARD = 120;
export const MAX_TARGETS_PER_ROUND = 60;
export const MAX_LEVEL = 99;
export const DEFAULT_BONUS_SLOTS = 2;
export const DEFAULT_BONUS_REWARD = "사나운 멧돼지 20개 + 직업에 맞는 보상 (자몽케이크·자몽주스·우파노래 등, 날마다 다를 수 있어요)";
export const DEFAULT_STANDARD_REWARD = "사나운 멧돼지 10개 + 망고워터 10개";
/** 길드 공지 그대로: 보상은 실제로 주고받는 데 며칠 걸릴 수 있다 */
export const PAYOUT_NOTE = "보상 지급은 1~2일 걸릴 수 있어요";

/** 참고용 보상 아이템 (제작자가 알려 준 골드 값. 실제로는 오피서가 이 값 안에서 자유롭게 골라 게임 안에서 준다) */
export const REWARD_ITEMS: { name: string; unit: string; gold: number }[] = [
  { name: "사나운 멧돼지", unit: "20개", gold: 120_000 },
  { name: "자몽주스", unit: "1개", gold: 60_000 },
  { name: "자몽케이크", unit: "1개", gold: 80_000 },
  { name: "망고워터", unit: "20개", gold: 35_000 },
];

/** 레벨 구간 참고표 기본값 (오피서가 조정할 수 있다. 신청·지급 계산에는 쓰지 않는 안내용 자료) */
/** 레벨 구간 참고표 기본값 (만렙 55, 제작자 2026-11-09 '레벨 더 많이 쪼개도 되겠다'). 구간은 겹치지 않는 Lv.min~max (둘 다 포함).
 *  30 아래는 빨라서 크게 묶고, 30부터 2레벨씩, 36부터는 1레벨씩, 45 넘으면 사람이 거의 없어 다시 크게 묶는다 */
export const DEFAULT_BRACKETS: { minLevel: number; maxLevel: number; note: string }[] = [
  { minLevel: 20, maxLevel: 24, note: "쉬움 · 한 구간으로 퉁침 (예: 사나운 멧돼지 5개)" },
  { minLevel: 25, maxLevel: 29, note: "쉬움 (예: 사나운 멧돼지 10개)" },
  { minLevel: 30, maxLevel: 31, note: "여기부터 어려워짐 (예: 사나운 멧돼지 10개 + 망고워터 5개)" },
  { minLevel: 32, maxLevel: 33, note: "어려움 (예: 사나운 멧돼지 10개 + 망고워터 10개)" },
  { minLevel: 34, maxLevel: 35, note: "어려움 (예: 사나운 멧돼지 15개 + 망고워터 10개)" },
  { minLevel: 36, maxLevel: 36, note: "많이 어려움 (예: 사나운 멧돼지 15개 + 망고워터 10개 + 자몽주스)" },
  { minLevel: 37, maxLevel: 37, note: "많이 어려움 (예: 사나운 멧돼지 20개 + 자몽주스)" },
  { minLevel: 38, maxLevel: 38, note: "38제 무기 +8강부터 1군 편입 고려 (예: 사나운 멧돼지 20개 + 직업 아이템)" },
  { minLevel: 39, maxLevel: 39, note: "보통 1군 편입 뒤 · 오피서·길마 판단 (예: 사나운 멧돼지 20개 + 직업 아이템)" },
  { minLevel: 40, maxLevel: 40, note: "오피서·길마 판단 (예: 사나운 멧돼지 20개 + 자몽케이크)" },
  { minLevel: 41, maxLevel: 41, note: "오피서·길마 판단 (예: 사나운 멧돼지 20개 + 자몽케이크)" },
  { minLevel: 42, maxLevel: 42, note: "오피서·길마 판단 (예: 사나운 멧돼지 20개 + 자몽케이크 + 직업 아이템)" },
  { minLevel: 43, maxLevel: 43, note: "오피서·길마 판단 (예: 사나운 멧돼지 20개 + 자몽케이크 + 직업 아이템)" },
  { minLevel: 44, maxLevel: 44, note: "보통 닿는 끝 · 오피서·길마 판단 (예: 사나운 멧돼지 20개 + 자몽케이크 + 직업 아이템)" },
  { minLevel: 45, maxLevel: 49, note: "인원 거의 없음 · 길마 판단" },
  { minLevel: 50, maxLevel: 55, note: "만렙 구간 · 길마 판단" },
];

export const validLevel = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_LEVEL;

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

/** 라운드 열기 입력 검사 (목표 목록·보상 글까지 한 번에) */
export function readRoundInput(b: {
  title?: unknown;
  note?: unknown;
  bonusSlots?: unknown;
  bonusReward?: unknown;
  standardReward?: unknown;
  targets?: unknown;
}):
  | {
      title: string;
      note: string | null;
      bonusSlots: number;
      bonusReward: string;
      standardReward: string;
      targets: { nickname: string; startLevel: number; endLevel: number; note: string | null }[];
    }
  | string {
  const title = text(b.title, MAX_TITLE);
  if (!title) return `라운드 이름을 ${MAX_TITLE}자 안으로 적어 주세요`;
  const note = text(b.note, MAX_NOTE);
  if (note === undefined) return `쪽지는 ${MAX_NOTE}자까지예요`;
  const bonusSlots = Number(b.bonusSlots ?? DEFAULT_BONUS_SLOTS);
  if (!Number.isInteger(bonusSlots) || bonusSlots < 0 || bonusSlots > 50) return "선착순 인원이 맞지 않아요";
  // 안 보내면 기본값, 보내면 글자 수만 본다 (빈 칸으로 보내는 건 틀린 입력)
  const rewardOr = (v: unknown, fallback: string) => (v === undefined ? fallback : text(v, MAX_REWARD));
  const bonusReward = rewardOr(b.bonusReward, DEFAULT_BONUS_REWARD);
  if (!bonusReward) return `선착순 보상은 ${MAX_REWARD}자 안으로 적어 주세요`;
  const standardReward = rewardOr(b.standardReward, DEFAULT_STANDARD_REWARD);
  if (!standardReward) return `완주 보상은 ${MAX_REWARD}자 안으로 적어 주세요`;
  if (!Array.isArray(b.targets) || !b.targets.length) return "목표를 하나 이상 넣어 주세요";
  if (b.targets.length > MAX_TARGETS_PER_ROUND) return `목표는 ${MAX_TARGETS_PER_ROUND}개까지예요`;
  const targets: { nickname: string; startLevel: number; endLevel: number; note: string | null }[] = [];
  for (const raw of b.targets as Record<string, unknown>[]) {
    const t = readTargetInput(raw ?? {});
    if (typeof t === "string") return t;
    targets.push(t);
  }
  return { title, note, bonusSlots, bonusReward, standardReward, targets };
}

export function readBracketInput(b: { minLevel?: unknown; maxLevel?: unknown; note?: unknown }):
  | { minLevel: number; maxLevel: number; note: string }
  | string {
  if (!validLevel(b.minLevel) || !validLevel(b.maxLevel)) return "레벨이 맞지 않아요";
  if ((b.maxLevel as number) < (b.minLevel as number)) return "끝 레벨이 시작 레벨보다 낮아요";
  const note = text(b.note, MAX_REWARD);
  if (!note) return `안내는 ${MAX_REWARD}자 안으로 적어 주세요`;
  return { minLevel: b.minLevel as number, maxLevel: b.maxLevel as number, note };
}

export interface RoundRow {
  id: number;
  title: string;
  note: string | null;
  starts_at: number;
  ends_at: number | null;
  bonus_slots: number;
  bonus_reward: string;
  standard_reward: string;
  active: number;
  created_by: string | null;
  created_at: number;
}

export interface TargetRow {
  id: number;
  round_id: number;
  nickname: string;
  start_level: number;
  end_level: number;
  note: string | null;
  created_at: number;
  updated_at: number;
}

export interface BracketRow {
  id: number;
  min_level: number;
  max_level: number;
  note: string;
  sort: number;
}

export interface ClaimRow {
  id: number;
  target_id: number;
  user_id: string;
  rank: number | null;
  reward: string | null;
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
export async function activeRound(env: Env): Promise<RoundRow | null> {
  return env.DB.prepare("SELECT * FROM quest2_rounds WHERE active = 1 ORDER BY id DESC LIMIT 1").first<RoundRow>();
}

export async function readBrackets(env: Env): Promise<BracketRow[]> {
  const { results } = await env.DB.prepare("SELECT * FROM quest2_brackets ORDER BY sort ASC, min_level ASC").all<BracketRow>();
  return results;
}

/** 그 닉네임(캐릭터)이 적어 둔 지금 레벨 (앱 계정이 없으면 null) */
export async function levelOf(env: Env, nickname: string): Promise<number | null> {
  const r = await env.DB.prepare("SELECT level FROM profiles WHERE user_id = ?").bind(nickname).first<{ level: number }>();
  return r?.level ?? null;
}

/** 이 라운드에서 완주 신청(도핑 전용 제외)이 몇 건 있었는지 (다음 신청의 순서 = 이 값 + 1) */
export async function completionCount(env: Env, roundId: number): Promise<number> {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM quest2_claims c JOIN quest2_targets t ON t.id = c.target_id WHERE t.round_id = ? AND c.rank IS NOT NULL",
  )
    .bind(roundId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** 운영(오피서 이상)에게 알림. 열기 전에는 앱개발자에게만 (나만 보이는 동안 오피서를 혼란스럽게 하지 않으려고) */
export async function notifyOfficers(env: Env, msg: string, from: string): Promise<void> {
  const where = QUEST2_OPEN ? "role IN ('officer', 'master', 'developer')" : "role = 'developer'";
  const { results } = await env.DB.prepare(`SELECT DISTINCT COALESCE(main_id, id) AS id FROM users WHERE ${where}`).all<{ id: string }>();
  await notify(env, results.map((r) => r.id), "quest2", msg, "#/quest2?v=staff", from);
}
