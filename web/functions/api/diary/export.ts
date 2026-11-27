// 비공개 자료 저장소(sapphire-imo-data)의 Actions(.github/workflows/diary-sync.yml)만 부른다. 로그인 대신 GitHub OIDC 토큰 (server/ghOidc.ts).
// 일지의 정산·기록 상태를 그 저장소(비공개)의 길드/일지_정산.json 으로 받아 가게 한다: 기록을 넣는 세션이 앱에서 누른 정산을 보고 정산 전 줄만 셈한다.
// 공개 저장소의 실행 기록에는 아무것도 찍지 않는다 (그 작업은 비공개 저장소에서 돈다). 다른 부름은 404.
// GET /api/diary/export -> { at, settles: [...], runs: [...] } (정산 전 줄은 지금 단가로 셈한 won)
import type { Env } from "../../../server/auth";
import { NOPE, readRates, valueOf } from "../../../server/diary";
import type { Run } from "../../../server/diary";
import { verifyGithubOidc } from "../../../server/ghOidc";

const GH = { audience: "sapphire-diary", repository: "hong-seok-young/sapphire-imo-data", workflow: "hong-seok-young/sapphire-imo-data/.github/workflows/diary-sync.yml", ref: "refs/heads/main" };

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await verifyGithubOidc(request, GH))) return NOPE();
  const [settles, runs, rates] = await Promise.all([
    env.DB.prepare("SELECT id, at, runs, sum, carry_in, pay, carry_out FROM diary_settles ORDER BY id").all(),
    env.DB.prepare("SELECT id, day, lv_from, exp_from, t_from, lv_to, exp_to, t_to, rate, memo, settle_id, won FROM diary_runs ORDER BY id").all<Run & { settle_id: number | null; won: number | null }>(),
    readRates(env),
  ]);
  const list = runs.results.map((r) => ({ ...r, won: r.settle_id ? r.won : Math.round((valueOf(r, rates) ?? 0) * 1000) / 1000 }));
  const open = list.filter((r) => !r.settle_id);
  const sum = open.reduce((t, r) => t + (r.won ?? 0), 0);
  return new Response(
    JSON.stringify({ at: Date.now(), settles: settles.results, open: { runs: open.length, sum: Math.round(sum), pay: Math.floor(sum / 1000) * 1000 }, runs: list }, null, 1),
    { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } },
  );
};
