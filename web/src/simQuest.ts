// 확률 시뮬레이터의 오늘의 도전과 칭호 (개발중, 제작자 요청 2026-11-04 '조금 재밌는 미니게임처럼').
// 도전은 날마다(한국 날짜) 아래 POOL 에서 셋을 고르고, 시뮬레이터가 결과마다 알리면(emit) 맞는 도전을 깬다. 깬 도전마다 서버가 코인 (server/simcoin.ts QUEST_COIN, 하루 한 번씩)
import { createContext, useContext } from "react";

export type SimEvent =
  | { kind: "enh"; part: string; scroll: string; level: number; combo: number }
  | { kind: "stat"; key: string; stage: number; max: number }
  | { kind: "opt"; luck: number }
  | { kind: "gem"; stage: number }
  | { kind: "box"; p: number }
  | { kind: "repair"; level: number }
  | { kind: "dun"; floor: number };

export interface Quest {
  id: string;
  text: string;
  done: (e: SimEvent) => boolean;
}
const POOL: Quest[] = [
  { id: "w8", text: "무기 일반 마법서로 +8", done: (e) => e.kind === "enh" && e.part === "무기" && e.scroll === "일반" && e.level >= 8 },
  { id: "w9", text: "무기 +9 (아무 마법서)", done: (e) => e.kind === "enh" && e.part === "무기" && e.level >= 9 },
  { id: "a6", text: "갑옷 +6", done: (e) => e.kind === "enh" && e.part === "갑옷" && e.level >= 6 },
  { id: "a7", text: "갑옷 +7", done: (e) => e.kind === "enh" && e.part === "갑옷" && e.level >= 7 },
  { id: "c3", text: "위험한 강화 3연속 성공", done: (e) => e.kind === "enh" && e.combo >= 3 },
  { id: "s3", text: "장비 스탯 부여 3단계", done: (e) => e.kind === "stat" && e.key === "50100" && e.stage >= e.max },
  { id: "p3", text: "펫 추가 옵션 3단계", done: (e) => e.kind === "stat" && e.key === "40100" && e.stage >= e.max },
  { id: "o2", text: "옵션 상위 1% 이상 뽑기", done: (e) => e.kind === "opt" && e.luck >= 2 },
  { id: "b1", text: "뽑기에서 1% 이하 아이템", done: (e) => e.kind === "box" && e.p <= 0.01 },
  { id: "b3", text: "뽑기에서 3% 이하 아이템", done: (e) => e.kind === "box" && e.p <= 0.03 },
  { id: "g3", text: "보석 3단계 만들기", done: (e) => e.kind === "gem" && e.stage >= 3 },
  { id: "g4", text: "보석 4단계 만들기", done: (e) => e.kind === "gem" && e.stage >= 4 },
  { id: "r5", text: "장비 수리로 +5 이상", done: (e) => e.kind === "repair" && e.level >= 5 },
  { id: "d20", text: "던전 20층", done: (e) => e.kind === "dun" && e.floor >= 20 },
];

const kstDay = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
/** 오늘의 도전 셋 (날짜로 섞어 모두 같은 셋을 본다) */
export function todayQuests(day = kstDay()): Quest[] {
  let h = 2166136261;
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), h / 4294967296);
  const list = [...POOL];
  const out: Quest[] = [];
  while (out.length < 3 && list.length) out.push(list.splice(Math.floor(rnd() * list.length), 1)[0]);
  return out;
}

/** 도박의 신 점수로 칭호 (제작자 2026-11-04: 통합 순위 이름 도박왕 -> 도박의 신) */
export function titleOf(total: number): string {
  if (total >= 12) return "도박의 신";
  if (total >= 8) return "강화의 신";
  if (total >= 5) return "행운의 손";
  if (total >= 2) return "운 좋은 길드원";
  return "견습 도박꾼";
}

export const QuestCtx = createContext<(e: SimEvent) => void>(() => undefined);
export const useQuest = () => useContext(QuestCtx);
