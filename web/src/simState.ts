// 확률 시뮬레이터 진행 상황 (제작자 2026-11-04 '8강 참나무지팡이 있었는데 장비 바꾸기 누르니까 없어졌네, 내가 만든 거 어디 감'):
// 들고 있는 장비, 보관함(다른 장비를 사거나 꺼내도 남는다), 앞 장비 +8 기록, 자동 구매 켬, 직접 겪은 것.
// 예전에는 폰(localStorage)에 부위마다 장비 하나만 두어 새로 사면 덮였다. 이제 서버(D1 sim_state / 테스트판 sim_t_state)에 JSON 하나로, 다른 폰에서도 그대로.
// 직접 겪은 것 (exp, 제작자 2026-11-04 '자동 강화는 우리가 강화해 본 곳까지만, 다른 것들도 마찬가지, 내가 수동으로 겪은 것만 자동으로 할 수 있음'):
//   'enh:<장비>' 직접 강화해 닿은 가장 높은 강화도, 'stat:<표>' 직접 닿은 가장 높은 단계, 'opt:<아이템>:<옵션 번호>' 직접 굴려 본 가장 높은 값,
//   'box:<상자>:<묶음>:<이름>' 직접 열어 나온 것 (1), 'gem:<단계>' 그 단계를 직접 합성해 봤다 (1)
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Part } from "./sim";
import type { Held } from "./simGear";

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
  /** 성장: 표마다 지금 단계·펫 옵션·처음부터 센 시도(순위용)·고른 장신구나 펫 이름(2026-11-17), 그리고 모든 표의 시도·성공·+2 성공 */
  stat?: Record<string, { stage: number; type: string | null; since: number; item?: string }>;
  /** 강화 도감 (2026-11-17 고도화): 장비마다 닿은 가장 높은 강화도 (어느 마법서로든, 팔거나 부서져도 남는다) */
  best?: Record<string, number>;
  /** 판 장비 수와 받은 코인 (2026-11-17) */
  sold?: { n: number; coins: number };
  /** 강화 비용 최저 기록 (2026-11-19): 순위 이름(simRank.ts upGame, 이번 주 것만 남긴다) -> [코인, 마법서]. 이보다 좋을 때만 서버에 보낸다 */
  cost?: Record<string, [number, number]>;
  /** 옵션 재설정: 전·후 중 더 좋은 쪽을 저절로 고른다 (2026-11-19) */
  optAuto?: boolean;
  statN?: { tries: number; ok: number; big: number };
  /** 보석 (gemOf 로 읽는다): 가진 보석결정(단계마다 inv[1~4]), 보석(sim.ts GemKind.id -> 수), 합성·세공·뽑기 수, 닿은 가장 높은 단계.
   *  v 2 (2026-11-19 '보석도 뽑아야'): 그 전에 공짜로 받던 보석결정(start 30 ~ 1000개)은 비우고 뽑은 보석으로만 한다 */
  gem?: GemSave;
  /** 상자: 상자·묶음마다 연 수와 나온 것 */
  box?: Record<string, { opened: number; tally: Record<string, number> }>;
}

export interface GemSave {
  inv: number[];
  runs: number;
  /** 예전 칸 (처음 1단계 개수): 더 쓰지 않는다 */
  start?: number;
  best: number;
  gems?: Record<string, number>;
  cuts?: number;
  pulls?: number;
  v?: number;
}
export const GEM_V = 2;
/** 보석 진행 상황을 읽는다. 예전 판(공짜 보석결정)이면 빈 것으로 */
export function gemOf(s: SimSave): Required<Omit<GemSave, "start">> {
  const g = s.gem;
  if (!g || g.v !== GEM_V) return { inv: [0, 0, 0, 0, 0], runs: 0, best: 0, gems: {}, cuts: 0, pulls: 0, v: GEM_V };
  return { inv: g.inv?.length === 5 ? g.inv : [0, 0, 0, 0, 0], runs: g.runs ?? 0, best: g.best ?? 0, gems: g.gems ?? {}, cuts: g.cuts ?? 0, pulls: g.pulls ?? 0, v: GEM_V };
}
/** 상자에서 나온 보석을 보석 칸에 넣는다 (ids: sim.ts gemIdOf) */
export function addGems(s: SimSave, ids: string[]): SimSave {
  if (!ids.length) return s;
  const b = gemOf(s);
  const gems = { ...b.gems };
  for (const id of ids) gems[id] = (gems[id] ?? 0) + 1;
  return { ...s, gem: { ...b, gems } };
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

/** 서버에 둔다: 바뀌면 쓴 코인과 같이 모아서 보낸다 (queue = simRank.ts useCoinState 의 queueState: 8초마다, 화면을 떠날 때는 바로) */
export function useSaveState(queue: (state: unknown) => void, initial: SimSave | null | undefined): SaveApi & { ready: boolean; set: (s: SimSave) => void } {
  const [save, setSave] = useState<SimSave>({});
  const [ready, setReady] = useState(false);
  const ref = useRef<SimSave>({});
  const set = useCallback(
    (s: SimSave) => {
      ref.current = s;
      setSave(s);
      queue(s);
    },
    [queue],
  );
  const update = useCallback((fn: (s: SimSave) => SimSave) => set(fn(ref.current)), [set]);
  useEffect(() => {
    if (initial === undefined || ready) return;
    ref.current = initial ?? {};
    setSave(ref.current);
    setReady(true);
  }, [initial, ready]);
  return { save, update, ready, set };
}
