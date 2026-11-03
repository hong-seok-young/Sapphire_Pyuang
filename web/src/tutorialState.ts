// 메뉴 튜토리얼이 도는지 (src/tutorial.tsx 가 켜고 끄고, 화면들은 useSample 로 '예시 자료'를 보일지 안다).
// 제작자 2026-11-03: 실제 자료(내가 올린 물건, 내 파티)에 기대니 지우거나 없으면 단계가 건너뛰어지거나 엉뚱한 칸을 비췄다 -> 튜토리얼 동안만 예시 자료를 보인다 (src/sample.ts)
import { useSyncExternalStore } from "react";

let key: string | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** 그 메뉴의 튜토리얼을 (다시) 시작한다 */
export function startTutorial(k: string) {
  key = k;
  seq++;
  emit();
}
export function stopTutorial() {
  key = null;
  emit();
}
export const tutorialOpen = () => key !== null;
const snapshot = () => (key === null ? "" : `${seq}:${key}`);
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
/** '' 이면 안 도는 중, 아니면 '순번:메뉴 key' (같은 메뉴를 다시 누르면 순번이 바뀌어 처음부터) */
export const useTutorial = () => useSyncExternalStore(subscribe, snapshot);
/** 튜토리얼 동안 화면에 예시 자료를 보일지 */
export const useSample = () => useTutorial() !== "";

// ---------- 한 번도 안 연 메뉴의 'Click!' 표 (제작자 요청 2026-11-03: 길드마크와 메뉴 맨 위 단추를 한 번도 안 눌렀으면 배지 애니메이션). 이 기기에 적는다 ----------
const SEEN_KEY = "sapphire.tut.seen";
const readSeen = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
};
let seen = readSeen();
export const tutorialSeen = (key: string) => seen.includes(key);
export function markTutorialSeen(key: string) {
  if (seen.includes(key)) return;
  seen = [...seen, key];
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* 저장 못 해도 이번엔 숨긴다 */
  }
  emit();
}
