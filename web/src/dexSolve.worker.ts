/// <reference lib="webworker" />
// 도감 계산기의 목표 능력치를 모두 채우는 가장 싼 항목 묶음 (제작자 2026-11-13 '어느 옵션을 적더라도 최저가로 그 도감을 만드는 조합과 가격이 떠야 해'):
// 항목마다 넣을지 말지(0/1)를 정하는 정수 최적화 문제라 HiGHS(에든버러 대학의 MIT 최적화 엔진, WebAssembly)로 정확히 푼다.
// 차례로 싼 것을 고르는 셈(planTargets)은 진짜 최저가보다 많게는 14% 비쌌다 (2026-11-13 무작위 목표 40개 시험).
import highsLoader from "highs";
import wasmUrl from "highs/runtime?url";

export interface SolveReq { id: number; costs: number[]; vals: [number, number][][]; targets: number[] }
export interface SolveRes { id: number; picks: number[] | null }

type Highs = Awaited<ReturnType<typeof highsLoader>>;
let highs: Promise<Highs> | null = null;
const load = () => (highs ??= highsLoader({ locateFile: () => wasmUrl }));

function lpOf(r: SolveReq): string {
  // 골드는 천 단위로 줄여 넣는다 (수가 너무 크면 엔진 오차가 커진다)
  const obj = r.costs.map((c, i) => `${Math.max(0, Math.round(c / 1000))} x${i}`).join(" + ");
  const rows = r.targets.map((t, j) => {
    const terms: string[] = [];
    r.vals.forEach((vs, i) => {
      for (const [k, v] of vs) if (k === j && v > 0) terms.push(`${v} x${i}`);
    });
    return ` c${j}: ${terms.join(" + ")} >= ${t - 1e-6}`;
  });
  return `Minimize\n obj: ${obj}\nSubject To\n${rows.join("\n")}\nBinary\n ${r.costs.map((_, i) => `x${i}`).join(" ")}\nEnd\n`;
}

self.onmessage = async (ev: MessageEvent<SolveReq>) => {
  const r = ev.data;
  let picks: number[] | null = null;
  try {
    if (r.costs.length) {
      const h = await load();
      const out = h.solve(lpOf(r), { time_limit: 15, mip_rel_gap: 1e-6, output_flag: false });
      if (out.Status === "Optimal" || out.Status === "Time limit reached") {
        const cols = out.Columns as Record<string, { Primal?: number }>;
        const p = r.costs.map((_, i) => i).filter((i) => (cols[`x${i}`]?.Primal ?? 0) > 0.5);
        // 시간 안에 다 못 풀어 해가 없으면 그대로 둔다
        picks = p.length ? p : null;
      }
    }
  } catch {
    picks = null;
  }
  (self as unknown as Worker).postMessage({ id: r.id, picks } satisfies SolveRes);
};
