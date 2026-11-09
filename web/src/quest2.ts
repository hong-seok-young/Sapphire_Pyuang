// 2군 성장 퀘스트 (개발중, 서버 server/quest2.ts, functions/api/quest2): 2군 캐릭터마다 목표 레벨까지 올리면 레벨 하나마다 정해진 골드가 쌓인다.
// '보상받기 신청'을 누르면 오피서에게 알림이 가고, 게임 안에서 실제로 준 뒤 오피서가 '지급 완료'를 누른다.
import { api } from "./auth";

export const MAX_NICK = 20;
export const MAX_TITLE = 40;
export const MAX_NOTE = 80;

/** 참고용 보상 아이템 (제작자가 알려 준 골드 값. 서버 server/quest2.ts REWARD_ITEMS 와 같다) */
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

export interface Quest2Round {
  id: number;
  title: string;
  note: string | null;
  startsAt: number;
  endsAt: number | null;
}

export interface Quest2Pending {
  id: number;
  gold: number;
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
  paidToLevel: number;
  currentLevel: number | null;
  claimableGold: number;
  /** 시작 레벨 == 목표 레벨 (이미 목표 달성 상태, 공포티모처럼): 사다리가 없고 도핑 지원만 신청할 수 있다 */
  doneAlready: boolean;
  /** 내 캐릭터인지 (신청 단추가 보인다) */
  mine: boolean;
  pending: Quest2Pending | null;
}

export interface Quest2PendingClaim {
  id: number;
  targetId: number;
  nickname: string;
  fromLevel: number;
  toLevel: number;
  gold: number;
  doping: boolean;
  note: string | null;
  requestedAt: number;
}

export interface Quest2Data {
  open: boolean;
  canManage: boolean;
  round: Quest2Round | null;
  bands: Band[];
  targets: Quest2Target[];
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

export const openRound = (input: { title: string; note: string | null; targets: { nickname: string; startLevel: number; endLevel: number; note: string | null }[] }) =>
  api<{ ok: boolean; roundId: number }>("/api/quest2/rounds", "POST", input);
export const saveBands = (bands: Band[]) => api<{ ok: boolean }>("/api/quest2/bands", "PUT", { bands });

/** 레벨 하나마다 올린 보상 줄 (band 는 minLevel 내림차순으로 본다) */
export function rewardLedger(from: number, to: number, bands: Band[]): { level: number; gold: number }[] {
  const sorted = [...bands].sort((a, b) => b.minLevel - a.minLevel);
  const goldFor = (lv: number) => sorted.find((b) => lv >= b.minLevel)?.goldPerLevel ?? 0;
  const rows: { level: number; gold: number }[] = [];
  for (let lv = from + 1; lv <= to; lv++) rows.push({ level: lv, gold: goldFor(lv) });
  return rows;
}

/** 목표까지 다 올렸을 때 총 보상 (지금까지 받은 것 + 앞으로 받을 것) */
export const totalReward = (t: Pick<Quest2Target, "startLevel" | "endLevel">, bands: Band[]) => rewardLedger(t.startLevel, t.endLevel, bands).reduce((s, r) => s + r.gold, 0);
