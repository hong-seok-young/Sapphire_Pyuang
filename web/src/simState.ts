// 확률 시뮬레이터 진행 상황 (제작자 2026-11-04 '8강 참나무지팡이 있었는데 장비 바꾸기 누르니까 없어졌네, 내가 만든 거 어디 감'):
// 들고 있는 장비, 보관함(다른 장비를 사거나 꺼내도 남는다), 앞 장비 +8 기록, 자동 구매 켬, 직접 겪은 것.
// 예전에는 폰(localStorage)에 부위마다 장비 하나만 두어 새로 사면 덮였다. 이제 서버(D1 sim_state / 테스트판 sim_t_state)에 JSON 하나로, 다른 폰에서도 그대로.
// 직접 겪은 것 (exp, 제작자 2026-11-04 '자동 강화는 우리가 강화해 본 곳까지만, 다른 것들도 마찬가지, 내가 수동으로 겪은 것만 자동으로 할 수 있음'):
//   'enh:<장비>' 직접 강화해 닿은 가장 높은 강화도, 'stat:<표>' 직접 닿은 가장 높은 단계, 'opt:<아이템>:<옵션 번호>' 직접 굴려 본 가장 높은 값,
//   'box:<상자>:<묶음>:<이름>' 직접 열어 나온 것 (1), 'gem:<단계>' 그 단계를 직접 합성해 봤다 (1)
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { apiHeaders } from "./auth";
import type { Part } from "./sim";
import type { Held } from "./simGear";
import type { Space } from "./simRank";

export interface SimSave {
  held?: Partial<Record<Part, Held | null>>;
  bag?: Partial<Record<Part, Held[]>>;
  cleared?: string[];
  exp?: Record<string, number>;
  autoBuy?: boolean;
  /** 예전 폰 자료와 순위 기록에서 장비를 되살렸다 (한 번만) */
  restored?: boolean;
  // 껐다 켜도 남는 기록 (제작자 2026-11-06 '껐다가 다시 오면 기록이 사라지네': 화면에만 있어서 다시 열면 0 이었다)
  /** 강화: 시도·부서진 장비·가장 높은 강화도·쓴 코인, 최근 결과 점 40개 */
  enh?: { n?: { tries: number; broke: number; best: number; coins: number }; log?: { to: number; ok: boolean; broke?: boolean; plus?: number }[] };
  /** 성장: 표마다 지금 단계·펫 옵션·처음부터 센 시도(순위용), 그리고 모든 표의 시도·성공·+2 성공 */
  stat?: Record<string, { stage: number; type: string | null; since: number }>;
  statN?: { tries: number; ok: number; big: number };
  /** 보석 합성: 가진 보석, 합성 수, 처음 1단계 개수, 닿은 가장 높은 단계 */
  gem?: { inv: number[]; runs: number; start: number; best: number };
  /** 상자: 상자·묶음마다 연 수와 나온 것 */
  box?: Record<string, { opened: number; tally: Record<string, number> }>;
}

/** 보관함은 부위마다 이만큼 */
export const BAG_MAX = 30;

export interface SaveApi {
  save: SimSave;
  update: (fn: (s: SimSave) => SimSave) => void;
}
export const SaveCtx = createContext<SaveApi>({ save: {}, update: () => undefined });
export const useSave = () => useContext(SaveCtx);

/**
 * 화면 값을 진행 상황에 같이 둔다 (useState 와 같게 쓴다): 처음엔 저장된 값, 바뀌면 진행 상황에 적는다 (서버에는 1.2초 모아서).
 * 처음 그릴 때는 적지 않는다
 */
export function useKept<T>(read: (s: SimSave) => T | undefined, write: (s: SimSave, v: T) => SimSave, initial: T) {
  const { save, update } = useSave();
  const [v, setV] = useState<T>(() => read(save) ?? initial);
  const writeRef = useRef(write);
  writeRef.current = write;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    update((s) => writeRef.current(s, v));
  }, [v, update]);
  return [v, setV] as const;
}

/** 직접 겪은 값 */
export const expOf = (s: SimSave, key: string) => s.exp?.[key] ?? 0;
/** 직접 겪은 값을 더 높으면 바꾼다 */
export const raiseExp = (s: SimSave, key: string, v: number): SimSave => (expOf(s, key) >= v ? s : { ...s, exp: { ...(s.exp ?? {}), [key]: v } });

/** 서버에 둔다: 바뀌면 1.2초 모아서, 화면을 떠날 때도 */
export function useSaveState(space: Space, initial: SimSave | null | undefined): SaveApi & { ready: boolean; set: (s: SimSave) => void } {
  const [save, setSave] = useState<SimSave>({});
  const [ready, setReady] = useState(false);
  const ref = useRef<SimSave>({});
  const dirty = useRef(false);
  const timer = useRef(0);
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    if (!dirty.current) return;
    dirty.current = false;
    void fetch(`/api/sim/wallet${space === "test" ? "?space=test" : ""}`, {
      method: "POST",
      credentials: "same-origin",
      headers: apiHeaders(true),
      body: JSON.stringify({ state: ref.current }),
      keepalive: true,
    }).catch(() => undefined);
  }, [space]);
  const set = useCallback(
    (s: SimSave) => {
      ref.current = s;
      setSave(s);
      dirty.current = true;
      if (!timer.current) timer.current = window.setTimeout(flush, 1200);
    },
    [flush],
  );
  const update = useCallback((fn: (s: SimSave) => SimSave) => set(fn(ref.current)), [set]);
  useEffect(() => {
    if (initial === undefined || ready) return;
    ref.current = initial ?? {};
    setSave(ref.current);
    setReady(true);
  }, [initial, ready]);
  useEffect(() => {
    const hide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      flush();
    };
  }, [flush]);
  return { save, update, ready, set };
}

/** 예전 폰 자료 (localStorage, 부위마다 장비 하나와 +8 기록): 테스트판을 처음 열 때 한 번 옮긴다 */
export function legacySave(id: string): SimSave {
  const read = <T,>(k: string): T | null => {
    try {
      return JSON.parse(localStorage.getItem(k) ?? "null") as T | null;
    } catch {
      return null;
    }
  };
  const held: Partial<Record<Part, Held | null>> = {};
  for (const part of ["무기", "갑옷"] as Part[]) {
    const h = read<Held>(`sapphire.sim.held.${id}.${part}`);
    if (h && typeof h.name === "string") held[part] = h;
  }
  const cleared = read<string[]>(`sapphire.sim.cleared.${id}`);
  let autoBuy = false;
  try {
    autoBuy = localStorage.getItem(`sapphire.sim.autobuy.${id}`) === "1";
  } catch {
    /* 없으면 꺼짐 */
  }
  let s: SimSave = { held, cleared: Array.isArray(cleared) ? cleared.filter((x) => typeof x === "string") : [], autoBuy };
  // 들고 있던 장비의 강화도는 직접 겪은 것으로 본다
  for (const h of Object.values(held)) if (h && !h.broken) s = raiseExp(s, `enh:${h.name}`, h.lv);
  return s;
}

/** 순위 기록('+8 참나무지팡이')에서 들고 있지 않은 장비를 보관함에 되살린다 (제작자 2026-11-04 '내가 만든 거 어디 감') */
export function restoreFromRecords(s: SimSave, mine: { game?: string; label: string }[]): SimSave {
  let out: SimSave = { ...s, bag: { ...(s.bag ?? {}) } };
  for (const r of mine) {
    const m = /^enh:(무기|갑옷):/.exec(r.game ?? "");
    const l = /^\+(\d+) (.+)$/.exec(r.label);
    if (!m || !l) continue;
    const part = m[1] as Part;
    const lv = Number(l[1]);
    const name = l[2];
    const have = [out.held?.[part], ...(out.bag?.[part] ?? [])].some((h) => h && !h.broken && h.name === name && h.lv >= lv);
    if (!have) out.bag![part] = [{ name, lv, broken: false, tries: 0, tainted: true }, ...(out.bag![part] ?? [])].slice(0, BAG_MAX);
    out = raiseExp(out, `enh:${name}`, lv);
  }
  return { ...out, restored: true };
}
