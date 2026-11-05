// 폰 뒤로 가기로 창 닫기 (제작자 요청 2026-11-05 '장비대여 무기 창에서 갤럭시 뒤로 가기 하면 홈이 가짐, 이러면 안 돼, 이 메뉴뿐만 아니라'):
// 화면 위에 뜬 창(팝업, 캐릭터 목록, 정보창, 대화창, 안내 창, 사진 보기, 배치 편집)이 열리면 같은 주소로 방문 기록을 하나 넣고(state.layer),
// 뒤로 가기가 오면 화면은 그대로 두고 그 창만 닫는다 (창 안에 창이 있으면 위의 것부터 하나씩).
// - 창을 단추·바깥 누르기로 닫으면 넣어 둔 기록을 뺀다 (history.back).
// - 창이 열린 채 다른 화면으로 가면 기록이 남는데, 나중에 뒤로 가다 그 기록에 닿으면 한 번 더 뒤로 가 건너뛴다 (화면이 안 바뀌는 헛도는 뒤로 가기 없음).
// - 위 줄 ◀ 는 열린 창을 닫고 앞 화면으로 간다 (router.ts goBack).
// - 튜토리얼이 도는 동안은 기록을 넣지 않는다: 그때 뒤로 가기는 튜토리얼을 끝내고, 튜토리얼이 연 창도 같이 닫는다 (tutorial.tsx).
import { useEffect, useRef } from "react";
import { tutorialOpen } from "./tutorialState";

/** 창 번호: 새로 고침해도 앞의 기록보다 늘 크게 (남은 기록의 번호와 섞이지 않게) */
let seq = Date.now();
/** 열려 있는 창: 번호 -> 닫기 */
const live = new Map<number, () => void>();
/** 위 줄 ◀ 로 창을 닫은 뒤 앞 화면으로 갈 때 (router.ts) */
let after: (() => void) | null = null;

const layerOf = (s: unknown): number => {
  const n = (s as { layer?: unknown } | null)?.layer;
  return typeof n === "number" ? n : 0;
};

/** 새로 고친 화면에 남은 창 기록을 빼는 동안(뒤로 한 번)은 새 창의 기록을 미뤄 둔다 (빼는 뒤로 가기가 새 기록을 지우지 않게) */
let settling = false;
const waiting: (() => void)[] = [];
const settle = () => {
  settling = false;
  for (const f of waiting.splice(0)) f();
};

window.addEventListener("popstate", () => {
  if (settling) return settle();
  const cur = layerOf(history.state);
  // 빠져나온 기록의 창을 닫는다 (위의 것부터)
  const gone = [...live.keys()].filter((id) => id > cur).sort((a, b) => b - a);
  for (const id of gone) {
    const close = live.get(id);
    live.delete(id);
    close?.();
  }
  // 닫힌 창이 남긴 기록(같은 주소)에 닿았으면 한 번 더 뒤로
  if (cur && !live.has(cur)) {
    history.back();
    return;
  }
  if (after && !live.size) {
    const then = after;
    after = null;
    then();
  }
});

// 창이 열린 채 새로 고친 화면: 남은 창 기록(같은 주소)을 빼 둔다
if (layerOf(history.state)) {
  settling = true;
  history.back();
  window.setTimeout(() => settling && settle(), 1500);
}

/** 열린 창의 수 */
export const openLayers = () => live.size;

/** 열린 창을 모두 닫은 뒤 then (위 줄 ◀) */
export function closeLayersThen(then: () => void) {
  if (!live.size) return then();
  after = then;
  history.go(-live.size);
}

/**
 * open 인 동안 폰 뒤로 가기가 이 창을 닫는다 (close 를 부른다). 열릴 때만 그려지는 창이면 open 에 true.
 * 단추로 닫든 뒤로 가기로 닫든 close 가 open 을 false 로(또는 창을 없애게) 만들면 된다
 */
export function useBackClose(open: boolean, close: () => void) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!open || tutorialOpen()) return;
    const id = ++seq;
    live.set(id, () => ref.current());
    const push = () => {
      if (!live.has(id)) return;
      // 화면 칸 표(depth, k)는 그대로 두고, 다른 기록 표(튜토리얼, 로그인으로 돌아가기, 예전 사진 보기)는 옮겨 적지 않는다
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { tut, tutFrom, backToLogin, photo, ...keep } = (history.state ?? {}) as Record<string, unknown>;
      history.pushState({ ...keep, layer: id }, "");
    };
    if (settling) waiting.push(push);
    else push();
    return () => {
      // 뒤로 가기로 닫힌 것이면 이미 빠졌다. 단추로 닫았거나 창이 없어졌으면 넣어 둔 기록이 맨 위일 때만 뺀다 (다른 화면으로 갔으면 그대로 두고 나중에 건너뛴다).
      // 한 번 미뤄서 본다: 이 창을 닫으면서 바로 다른 창을 열었으면(정보 수정 등) 새 창의 기록이 위에 있어 빼지 않고, 나중에 뒤로 가다 건너뛴다
      if (!live.delete(id)) return;
      window.setTimeout(() => {
        if (layerOf(history.state) === id) history.back();
      }, 0);
    };
  }, [open]);
}
