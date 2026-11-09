// 2군 성장 퀘스트 (개발중, 서버 server/quest2.ts, functions/api/quest2): 2군 캐릭터마다 목표 레벨까지 다 올리면(완주) 보상을 신청할 수 있다.
// 보상은 골드가 아니라 실제 게임 안 물건(글로 적는다, 날마다·직업마다 다를 수 있다). 먼저 완주한 몇 명은 더 큰 보상, 나머지 완주자는 보통 보상.
// '보상받기 신청'을 누르면 오피서에게 알림이 가고, 게임 안에서 실제로 준 뒤(1~2일 걸릴 수 있다) 오피서가 '지급 완료'를 누른다.
import { api } from "./auth";

export const MAX_NICK = 20;
export const MAX_TITLE = 40;
export const MAX_NOTE = 80;
export const MAX_REWARD = 120;
export const DEFAULT_BONUS_SLOTS = 2;
export const DEFAULT_BONUS_REWARD = "사나운 멧돼지 20개 + 직업에 맞는 보상 (자몽케이크·자몽주스·우파노래 등, 날마다 다를 수 있어요)";
export const DEFAULT_STANDARD_REWARD = "사나운 멧돼지 10개 + 망고워터 10개";

/** 참고용 보상 아이템 (제작자가 알려 준 골드 값. 서버 server/quest2.ts REWARD_ITEMS 와 같다) */
export const REWARD_ITEMS: { name: string; unit: string; gold: number }[] = [
  { name: "사나운 멧돼지", unit: "20개", gold: 120_000 },
  { name: "자몽주스", unit: "1개", gold: 60_000 },
  { name: "자몽케이크", unit: "1개", gold: 80_000 },
  { name: "망고워터", unit: "20개", gold: 35_000 },
];

export interface Quest2Round {
  id: number;
  title: string;
  note: string | null;
  startsAt: number;
  endsAt: number | null;
  bonusSlots: number;
  bonusReward: string;
  standardReward: string;
  /** 이 라운드에서 완주 신청이 몇 건 있었는지 (선착순 남은 자리 = bonusSlots - completed) */
  completed: number;
}

/** 시작 -> 목표 사이에서 지금 어디쯤인지 0~1 (레벨을 모르면 0) */
export function progressOf(t: Pick<Quest2Target, "startLevel" | "endLevel" | "currentLevel" | "doneAlready">): number {
  if (t.doneAlready) return 1;
  if (t.currentLevel === null) return 0;
  const span = t.endLevel - t.startLevel;
  return span <= 0 ? 1 : Math.min(1, Math.max(0, (t.currentLevel - t.startLevel) / span));
}

export interface Quest2Bracket {
  id: number;
  minLevel: number;
  maxLevel: number;
  note: string;
}

export interface Quest2Pending {
  id: number;
  reward: string | null;
  doping: boolean;
  note: string | null;
  requestedAt: number;
}

export interface Quest2Target {
  id: number;
  nickname: string;
  startLevel: number;
  endLevel: number;
  note: string | null;
  currentLevel: number | null;
  /** 시작 레벨 == 목표 레벨 (이미 목표 달성 상태, 공포티모처럼): 완주상이 없고 도핑 지원만 신청할 수 있다 */
  doneAlready: boolean;
  /** 지금 레벨이 목표 레벨 이상인지 (doneAlready 는 늘 false) */
  done: boolean;
  /** 내 캐릭터인지 (신청 단추가 보인다) */
  mine: boolean;
  /** 신청해서 이미 지급까지 끝났는지 (더는 신청 못 함) */
  claimed: boolean;
  pending: Quest2Pending | null;
}

export interface Quest2PendingClaim {
  id: number;
  targetId: number;
  nickname: string;
  rank: number | null;
  reward: string | null;
  doping: boolean;
  note: string | null;
  requestedAt: number;
}

export interface Quest2Data {
  open: boolean;
  canManage: boolean;
  round: Quest2Round | null;
  brackets: Quest2Bracket[];
  targets: Quest2Target[];
  payoutNote: string;
  pendingClaims?: Quest2PendingClaim[];
}

export const fetchQuest2 = () => api<Quest2Data>("/api/quest2");
export const requestClaim = (targetId: number, doping: boolean, note: string | null) =>
  api<{ ok: boolean }>("/api/quest2/claims", "POST", { targetId, doping, note });
export const payClaim = (id: number) => api<{ ok: boolean }>(`/api/quest2/claims/${id}`, "PATCH", { action: "pay" });
export const rejectClaim = (id: number, note: string | null) => api<{ ok: boolean }>(`/api/quest2/claims/${id}`, "PATCH", { action: "reject", note });

export const addTarget = (input: { nickname: string; startLevel: number; endLevel: number; note: string | null }) =>
  api<{ ok: boolean; id: number }>("/api/quest2/targets", "POST", input);
export const editTarget = (id: number, input: { startLevel?: number; endLevel?: number; note?: string | null }) =>
  api<{ ok: boolean }>(`/api/quest2/targets/${id}`, "PATCH", input);
export const deleteTarget = (id: number) => api<{ ok: boolean }>(`/api/quest2/targets/${id}`, "DELETE");

export const openRound = (input: {
  title: string;
  note: string | null;
  bonusSlots: number;
  bonusReward: string;
  standardReward: string;
  targets: { nickname: string; startLevel: number; endLevel: number; note: string | null }[];
}) => api<{ ok: boolean; roundId: number }>("/api/quest2/rounds", "POST", input);

export const addBracket = (input: { minLevel: number; maxLevel: number; note: string }) =>
  api<{ ok: boolean; id: number }>("/api/quest2/brackets", "POST", input);
export const editBracket = (id: number, input: { minLevel?: number; maxLevel?: number; note?: string }) =>
  api<{ ok: boolean }>(`/api/quest2/brackets/${id}`, "PATCH", input);
export const deleteBracket = (id: number) => api<{ ok: boolean }>(`/api/quest2/brackets/${id}`, "DELETE");
