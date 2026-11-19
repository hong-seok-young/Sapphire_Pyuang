// 확률 시뮬레이터의 행운 코인과 순위 (개발중, 제작자 요청 2026-11-04). 서버 functions/api/sim, server/simcoin.ts.
// 코인: 웹에서 유의미한 일을 하면 쌓이고(서버), 시도할 때마다 화면이 하나씩 줄여 모아서 보낸다.
// 2026-11-19: 쓴 코인과 진행 상황(src/simState.ts)을 한 요청으로 모아 8초마다(화면을 떠날 때는 바로) 보낸다. 예전에는 1.5초·1.2초마다 따로 보내 요청과 쓰기가 많았다 (docs/무료한도.md).
// 순위 (2026-11-19 제작자 '통합 랭킹, 계급으로'): 명성 = 지금까지 쓴 코인 하나로 전체(계급)와 이번 주. 계급 이름·계급장은 src/simTier.ts, pages/SimBadge.tsx.
//   시뮬레이터 안의 작은 순위(강화 비용, 스탯 부여)는 이번 주 것만 (weekGame: 기록 이름 끝에 주 번호). 옵션·뽑기·보석의 '가장 드문 것' 순위는 뺐고 드문 결과는 전광판에만 (sendFeed)
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, apiHeaders } from "./auth";
import type { Steps } from "./sim";
import { weekStart } from "./week";

export type Cat = "enhance" | "grow" | "option" | "gem" | "box";
export interface SimRec {
  user_id?: string;
  game?: string;
  cat?: Cat;
  label: string;
  score: number;
  tries: number;
  luck: number;
  at?: number;
  rank?: number;
  /** 그 사람의 명성 (계급장) */
  xp?: number | null;
}
export interface FeedRow {
  user_id: string;
  /** 'rank' 면 승급 (label = 계급 번호), 아니면 드문 결과 (label = 무엇이 나왔나) */
  game: string;
  label: string;
  at: number;
  xp?: number | null;
}
export interface Wallet {
  coins: number;
  earned: number;
  /** 지금까지 쓴 코인 = 명성 */
  spent: number;
  /** 이번 주(목요일 10시부터)에 쓴 코인 */
  weekSpent: number;
  wk: number;
  rules: { key: string; label: string; coin: number; cap: number; n: number; to?: string }[];
  /** 연속 접속 (2026-11-17): 오늘까지 이어진 날 수와 오늘 받은 보너스 */
  streak?: { days: number; bonus: number; step: number; max: number };
  /** 오늘 장비를 판 횟수와 한도 */
  sold?: { n: number; cap: number; max: number };
  /** 오늘의 도전 셋을 깼는지 */
  quests: boolean[];
  questCoin: number;
  /** 전광판: 사흘 안의 드문 결과와 승급 */
  feed: FeedRow[];
  /** 앱개발자: floor 아래로 내려가면 add 를 채운다 (서버 server/simcoin.ts 와 같은 규칙) */
  refill: { floor: number; add: number } | null;
  /** 해금한 것 ('auto:장비', 'buy:장비') */
  unlocks?: string[];
}
/** 통합 순위 한 줄: 닉네임과 명성 (이번 주 순위면 이번 주 명성) */
export interface BoardRow {
  user_id: string;
  xp: number;
  /** 이번 주 순위 줄: 그 사람의 전체 명성 (계급장) */
  total?: number;
}
export interface Board {
  all: BoardRow[];
  week: BoardRow[];
  /** 내 명성과 등수 (순위에서 빠지는 계정은 등수가 null) */
  me: { xp: number; week: number; rank: number | null; weekRank: number | null } | null;
  wk: number;
}

/** 공간: 테스트판은 2026-11-19 에 뺐다 (늘 개발 중판). 예전 코드가 쓰는 이름만 남긴다 */
export type Space = "live" | "test";
export const SpaceCtx = createContext<Space>("live");
export const useSpace = () => useContext(SpaceCtx);
export const simUrl = (path: string, _space?: Space) => path;
export const fetchWallet = (lite = false) => api<Wallet & { state?: unknown }>(`/api/sim/wallet${lite ? "?lite=1" : ""}`);
export const fetchGame = (game: string) => api<{ board: SimRec[]; mine: SimRec | null }>(`/api/sim?game=${encodeURIComponent(game)}`);
export const fetchBoard = () => api<Board>("/api/sim");

/** 이번 주 번호 (목요일 10시마다 바뀐다): 이번 주 기록 이름 끝에 붙인다 */
export const weekId = (now = Date.now()) => Math.round(weekStart(now) / 604_800_000).toString(36);
export const weekGame = (game: string) => `${game}@${weekId()}`;
// 강화 비용 순위 (제작자 2026-11-19 '이 무기를 최저 비용으로 +8강까지 띄운 사람', 같은 날 '한 번 1위 먹으면 무한정 1위는 안 되게' -> 이번 주 것만):
// 비용 = 그 장비를 +0 부터 그 강화도까지 올리며 쓴 코인 (장비 값 + 마법서, 부서져 다시 산 것까지).
// 기록 이름 'up:<장비>:<마법서>:<강화도>[:ev]@<주>', 점수 = -비용 (적게 쓴 사람이 위), tries = 마법서 수
export const upGame = (gear: string, scroll: string, lv: number, ev: boolean) => weekGame(`up:${gear}:${scroll}:${lv}${ev ? ":ev" : ""}`);
/** 기록을 보낸다 (서버는 내 기록보다 좋을 때만 바꾼다) */
export const sendRecord = (game: string, cat: Cat, r: { label: string; score: number; tries: number; luck: number }) => api<{ ok: boolean; better?: boolean }>("/api/sim", "POST", { ...r, cat, game });
/** 전광판에만 남긴다: 1/100 보다 드문 결과 (한 화면에서 10초에 한 번만 보낸다, 서버도 한 사람 10초에 하나) */
let lastFeed = 0;
export function sendFeed(game: string, label: string, luck: number): void {
  if (!(luck >= 2) || Date.now() - lastFeed < 10_000) return;
  lastFeed = Date.now();
  api("/api/sim", "POST", { feed: true, game: game.slice(0, 60), label: label.slice(0, 60), luck }).catch(() => undefined);
}
/** 새 칭호가 됐다고 알린다 (서버가 명성으로 확인하고 전광판에 한 번) */
export const sendPromo = (n: number) => api("/api/sim", "POST", { promo: n }).catch(() => undefined);

/** 확률 -> 운 (1/10 이면 1, 1/1000 이면 3) */
export const luckOf = (p: number) => Math.min(15, Math.max(0, -Math.log10(Math.max(p, 1e-15))));

/** +0 에서 시작해 n 번 안에 목표에 닿을 확률 (실패하면 파괴, keep 이면 그대로) */
export function reachWithin(rate: (lv: number) => number, keep: boolean, goal: number, n: number): number {
  let dist = new Float64Array(goal + 1);
  dist[0] = 1;
  let reached = 0;
  for (let t = 0; t < Math.min(n, 20000); t++) {
    const next = new Float64Array(goal + 1);
    for (let k = 0; k < goal; k++) {
      const m = dist[k];
      if (!m) continue;
      const p = rate(k + 1);
      if (k + 1 === goal) reached += m * p;
      else next[k + 1] += m * p;
      if (keep) next[k] += m * (1 - p);
    }
    dist = next;
  }
  return reached;
}

/** 0단계에서 n 번 안에 끝 단계에 닿을 확률 (실패하면 그대로) */
export function stepsWithin(st: Steps, n: number): number {
  let dist = new Float64Array(st.max + 1);
  dist[0] = 1;
  let reached = 0;
  for (let t = 0; t < Math.min(n, 20000); t++) {
    const next = new Float64Array(st.max + 1);
    for (let s = 0; s < st.max; s++) {
      const m = dist[s];
      if (!m) continue;
      const { a, b } = st.steps[s] ?? { a: 0, b: 0 };
      const add = (to: number, q: number) => {
        if (to >= st.max) reached += m * q;
        else next[to] += m * q;
      };
      add(s + 1, a);
      add(s + 2, b);
      next[s] += m * (1 - a - b);
    }
    dist = next;
  }
  return reached;
}

// ---------------------------------------------------------------- 코인

export interface Coins {
  /** 아직 못 받았으면 null */
  coins: number | null;
  /** n 개를 쓴다: 실제로 쓴 수 (모자라면 있는 만큼) */
  take: (n: number) => number;
  /** 지금 n 개가 있는지 (자동 구매처럼 한꺼번에 내야 할 때) */
  has: (n: number) => boolean;
  /** 해금한 것 ('auto:장비 이름' 자동 강화, 'buy:장비 이름' 자동 구매) */
  unlocks: Set<string>;
  /** cost 코인으로 해금 (서버에 바로, 모아 둔 시도도 같이 보낸다). 됐으면 true */
  unlock: (key: string, cost: number) => Promise<boolean>;
  /** 장비를 팔아 gain 코인을 받는다 (서버에 바로). 됐으면 true (하루 한도가 끝나면 false) */
  sell: (gain: number) => Promise<boolean>;
}
export const CoinCtx = createContext<Coins>({ coins: null, take: () => 0, has: () => false, unlocks: new Set(), unlock: async () => false, sell: async () => false });
export const useCoins = () => useContext(CoinCtx);

/** 모아서 보내는 간격: 쓴 코인이나 진행 상황이 바뀌고 이만큼 뒤에 한 번 (화면을 떠나거나 다른 앱으로 가면 바로) */
const SYNC_MS = 8000;
const post = (body: unknown, keepalive = false) =>
  fetch("/api/sim/wallet", { method: "POST", credentials: "same-origin", headers: apiHeaders(true), body: JSON.stringify(body), keepalive });

export interface CoinState extends Coins {
  wallet: (Wallet & { state?: unknown }) | null;
  /** 지갑을 다시 받는다 (전광판, 오늘 번 코인). 처음 한 번만 진행 상황까지 */
  reload: () => void;
  /** 명성 (지금까지 쓴 코인): 서버 값 + 아직 안 보낸 것. 줄어들지 않는다 */
  xp: number;
  /** 이번 주 명성 */
  weekXp: number;
  /** 진행 상황을 다음 보낼 때 같이 보낸다 (src/simState.ts) */
  queueState: (state: unknown) => void;
}

export function useCoinState(_space?: Space): CoinState {
  const [wallet, setWallet] = useState<(Wallet & { state?: unknown }) | null>(null);
  const [unlocks, setUnlocks] = useState<Set<string>>(() => new Set());
  const [coins, setCoins] = useState<number | null>(null);
  const [xp, setXp] = useState(0);
  const [weekXp, setWeekXp] = useState(0);
  const left = useRef<number | null>(null);
  const refill = useRef<Wallet["refill"]>(null);
  // 아직 안 보낸 쓴 코인, 지갑을 받은 뒤 보낸 것 (명성 = 서버 값 + 보낸 것 + 안 보낸 것)
  const pending = useRef(0);
  const sent = useRef(0);
  const base = useRef({ xp: 0, week: 0, wk: 0 });
  const shown = useRef({ xp: 0, week: 0 });
  const dirty = useRef<{ state: unknown } | null>(null);
  const timer = useRef(0);
  const loaded = useRef(false);
  // 보내는 중인 요청과 지갑을 다시 받는 중인지: 둘이 엇갈리면 서버가 아직 안 줄인 코인이 화면에 잠깐 더 보였다가 줄어든다 (숫자가 늘었다 줄었다).
  // 그래서 다시 받기는 보내는 것이 끝난 뒤에, 다시 받는 동안에는 보내기를 미룬다
  const sending = useRef<Promise<unknown> | null>(null);
  const loading = useRef(false);
  const fame = useCallback(() => {
    const more = sent.current + pending.current;
    // 주가 바뀌면(목요일 10시) 이번 주 명성은 0 부터
    const sameWeek = base.current.wk === weekStart();
    shown.current = { xp: Math.max(shown.current.xp, base.current.xp + more), week: sameWeek ? Math.max(shown.current.week, base.current.week + more) : more };
    setXp(shown.current.xp);
    setWeekXp(shown.current.week);
  }, []);
  const flush = useCallback((leaving = false) => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    if (loading.current && !leaving) {
      timer.current = window.setTimeout(() => flush(), 1500);
      return;
    }
    const n = pending.current;
    const st = dirty.current;
    if (!n && !st) return;
    pending.current = 0;
    sent.current += n;
    dirty.current = null;
    const body = JSON.stringify({ spend: n || undefined, state: st ? st.state : undefined });
    // 화면을 떠날 때는 keepalive 로 (64KB 넘는 본문은 keepalive 로 못 보낸다)
    const job = fetch("/api/sim/wallet", { method: "POST", credentials: "same-origin", headers: apiHeaders(true), body, keepalive: leaving && body.length < 60_000 })
      .catch(() => undefined)
      .finally(() => {
        if (sending.current === job) sending.current = null;
      });
    sending.current = job;
  }, []);
  const arm = useCallback(() => {
    if (!timer.current) timer.current = window.setTimeout(() => flush(), SYNC_MS);
  }, [flush]);
  const queueState = useCallback(
    (state: unknown) => {
      dirty.current = { state };
      arm();
    },
    [arm],
  );
  const reload = useCallback(() => {
    if (loading.current) return;
    const lite = loaded.current;
    loading.current = true;
    (sending.current ?? Promise.resolve())
      .then(() => fetchWallet(lite))
      .finally(() => {
        loading.current = false;
      })
      .then(
      (w) => {
        loaded.current = true;
        // 가벼운 답에는 진행 상황과 해금이 없다: 처음 받은 것을 그대로 둔다
        setWallet((old) => (lite && old ? { ...old, ...w, state: old.state, unlocks: old.unlocks } : w));
        if (!lite) setUnlocks(new Set(w.unlocks ?? []));
        refill.current = w.refill ?? null;
        left.current = w.coins - pending.current;
        setCoins(left.current);
        base.current = { xp: w.spent, week: w.weekSpent, wk: w.wk };
        sent.current = 0;
        fame();
      },
      () => undefined,
    );
  }, [fame]);
  useEffect(() => {
    reload();
    const hide = () => document.visibilityState === "hidden" && flush(true);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", hide);
      flush(true);
    };
  }, [reload, flush]);
  const take = useCallback(
    (n: number) => {
      if (left.current === null) return 0;
      const k = Math.max(0, Math.min(n, left.current));
      if (!k) return 0;
      left.current -= k;
      pending.current += k;
      const r = refill.current;
      if (r && left.current < r.floor) left.current += r.add;
      setCoins(left.current);
      fame();
      arm();
      return k;
    },
    [arm, fame],
  );
  const has = useCallback((n: number) => left.current !== null && left.current >= n, []);
  const unlock = useCallback(
    async (key: string, cost: number) => {
      if (left.current === null || left.current < cost) return false;
      const spend = pending.current;
      pending.current = 0;
      sent.current += spend;
      try {
        const r = await post({ spend: spend || undefined, unlock: key, cost });
        const j = (await r.json()) as { coins?: number; unlocks?: string[]; paid?: boolean };
        if (typeof j.coins === "number") {
          left.current = j.coins - pending.current;
          setCoins(left.current);
        }
        if (j.unlocks) setUnlocks(new Set(j.unlocks));
        // 해금 값도 쓴 코인이라 명성에 더한다
        if (r.ok && j.paid) {
          sent.current += cost;
          fame();
        }
        return r.ok;
      } catch {
        sent.current -= spend;
        pending.current += spend;
        return false;
      }
    },
    [fame],
  );
  const sell = useCallback(async (gain: number) => {
    if (left.current === null || !(gain >= 1)) return false;
    const spend = pending.current;
    pending.current = 0;
    sent.current += spend;
    try {
      if (spend) await post({ spend });
      const r = await post({ sell: Math.round(gain) });
      const j = (await r.json()) as { coins?: number; sold?: boolean };
      if (typeof j.coins === "number") {
        left.current = j.coins - pending.current;
        setCoins(left.current);
      }
      if (j.sold) setWallet((w) => (w && w.sold ? { ...w, sold: { ...w.sold, n: w.sold.n + 1 } } : w));
      return !!j.sold;
    } catch {
      return false;
    }
  }, []);
  // 값이 바뀔 때만 새 묶음 (쓰는 쪽의 자동 반복이 다시 그릴 때마다 새로 시작하지 않게)
  return useMemo(() => ({ coins, take, has, unlocks, unlock, sell, wallet, reload, xp, weekXp, queueState }), [coins, take, has, unlocks, unlock, sell, wallet, reload, xp, weekXp, queueState]);
}

// ---------------------------------------------------------------- 이번 주 순위 (시뮬레이터 안의 작은 순위)

/** 한 기록의 순위와 내 기록. submit 은 내 기록보다 좋을 때만 보낸다 */
export function useRecord(game: string) {
  const [data, setData] = useState<{ board: SimRec[]; mine: SimRec | null } | null>(null);
  const mine = useRef<SimRec | null>(null);
  // 보는 순위가 바뀐 뒤에 늦게 온 앞 순위의 답은 버린다 (강화도마다 순위가 달라 자주 바뀐다)
  const now = useRef(game);
  now.current = game;
  const load = useCallback(() => {
    if (!game) return;
    fetchGame(game).then(
      (d) => {
        if (now.current !== game) return;
        mine.current = d.mine;
        setData(d);
      },
      () => undefined,
    );
  }, [game]);
  useEffect(() => {
    setData(null);
    mine.current = null;
    load();
  }, [load]);
  const submit = useCallback(
    (cat: Cat, r: { label: string; score: number; tries: number; luck: number }) => {
      const m = mine.current;
      if (!game) return false;
      const better = !m || r.score > m.score || (r.score === m.score && r.tries < m.tries);
      if (!better) return false;
      mine.current = { ...r, cat };
      sendRecord(game, cat, r).then(load, () => undefined);
      return true;
    },
    [game, load],
  );
  return { data, submit, reload: load };
}
