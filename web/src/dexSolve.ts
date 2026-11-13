// 목표 능력치를 모두 채우는 가장 싼 항목 묶음을 일꾼(Web Worker)에서 정확히 푼다 (dexSolve.worker.ts).
// 화면은 먼저 차례로 고른 묶음을 바로 보이고, 정확한 답이 오면 바꿔 끼운다.
import type { SolveReq, SolveRes } from "./dexSolve.worker";

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (p: number[] | null) => void>();
const cache = new Map<string, number[] | null>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./dexSolve.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<SolveRes>) => {
      const done = waiting.get(ev.data.id);
      waiting.delete(ev.data.id);
      done?.(ev.data.picks);
    };
    worker.onerror = () => {
      for (const done of waiting.values()) done(null);
      waiting.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** costs: 항목마다 골드(값 모름은 아주 큰 값으로), vals: 항목마다 [목표 번호, 값], targets: 목표 번호마다 채울 값. 고른 항목 번호, 못 풀면 null */
export function solveCover(key: string, costs: number[], vals: [number, number][][], targets: number[]): Promise<number[] | null> {
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((resolve) => {
    waiting.set(id, (p) => {
      if (cache.size > 40) cache.clear();
      cache.set(key, p);
      resolve(p);
    });
    w.postMessage({ id, costs, vals, targets } satisfies SolveReq);
  });
}
