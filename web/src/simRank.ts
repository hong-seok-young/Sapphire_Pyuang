// 확률 시뮬레이터의 행운 코인과 순위 (개발중, 제작자 요청 2026-11-04). 서버 functions/api/sim, server/simcoin.ts.
// 코인: 웹에서 유의미한 일을 하면 쌓이고(서버), 시도할 때마다 화면이 하나씩 줄여 모아서 보낸다(1.5초마다, 화면을 떠날 때).
// 순위: 시뮬레이터마다 가장 좋은 기록 하나 (score 가 높을수록, 같으면 tries 가 적을수록), 도박왕은 묶음마다 가장 큰 운(luck = log10(1/확률))의 합.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, apiHeaders } from "./auth";
import type { Steps } from "./sim";

export type Cat = "enhance" | "grow" | "option" | "gem" | "box";
export const CAT_NAME: Record<Cat, string> = { enhance: "강화", grow: "성장", option: "옵션", gem: "보석", box: "뽑기" };
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
}
export interface Wallet {
  coins: number;
  earned: number;
  spent: number;
  rules: { key: string; label: string; coin: number; cap: number; n: number }[];
  /** 오늘의 도전 셋을 깼는지 */
  quests: boolean[];
  questCoin: number;
  /** 전광판: 사흘 안에 1/100 보다 드문 결과 */
  feed: { user_id: string; game: string; label: string; luck: number; at: number }[];
  /** 내 도박왕 점수 */
  total: number;
}
export interface King {
  user_id: string;
  total: number;
  /** 'enhance:2.31,box:1.8' */
  parts: string;
}

export const fetchWallet = () => api<Wallet>("/api/sim/wallet");
export const fetchBoard = (game: string) => api<{ board: SimRec[]; mine: SimRec | null }>(`/api/sim?game=${encodeURIComponent(game)}`);
export const fetchKing = () => api<{ king: King[]; firsts: SimRec[]; mine: SimRec[] }>("/api/sim");

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
}
export const CoinCtx = createContext<Coins>({ coins: null, take: () => 0 });
export const useCoins = () => useContext(CoinCtx);

export function useCoinState(): Coins & { wallet: Wallet | null; reload: () => void } {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [coins, setCoins] = useState<number | null>(null);
  const left = useRef<number | null>(null);
  const pending = useRef(0);
  const timer = useRef(0);
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    const n = pending.current;
    if (!n) return;
    pending.current = 0;
    void fetch("/api/sim/wallet", { method: "POST", credentials: "same-origin", headers: apiHeaders(true), body: JSON.stringify({ spend: n }), keepalive: true }).catch(() => undefined);
  }, []);
  const reload = useCallback(() => {
    fetchWallet().then(
      (w) => {
        setWallet(w);
        left.current = w.coins - pending.current;
        setCoins(left.current);
      },
      () => undefined,
    );
  }, []);
  useEffect(() => {
    reload();
    const hide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      flush();
    };
  }, [reload, flush]);
  const take = useCallback(
    (n: number) => {
      if (left.current === null) return 0;
      const k = Math.max(0, Math.min(n, left.current));
      if (!k) return 0;
      left.current -= k;
      pending.current += k;
      setCoins(left.current);
      if (!timer.current) timer.current = window.setTimeout(flush, 1500);
      return k;
    },
    [flush],
  );
  return { coins, take, wallet, reload };
}

// ---------------------------------------------------------------- 순위

/** 한 시뮬레이터의 순위와 내 기록. submit 은 내 기록보다 좋을 때만 보낸다 */
export function useRecord(game: string) {
  const [data, setData] = useState<{ board: SimRec[]; mine: SimRec | null } | null>(null);
  const mine = useRef<SimRec | null>(null);
  const load = useCallback(() => {
    if (!game) return;
    fetchBoard(game).then(
      (d) => {
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
      // 내 기록보다 못해도 1/100 보다 드물면 전광판에 남긴다
      if (!better && r.luck < 2) return false;
      if (better) mine.current = { ...r, cat };
      api<{ ok: boolean }>("/api/sim", "POST", { ...r, cat, game }).then(load, () => undefined);
      return better;
    },
    [game, load],
  );
  return { data, submit };
}
