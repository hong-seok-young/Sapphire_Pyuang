// 이번 달 AI 비용을 Claude 콘솔(Usage and Cost Analytics API)에서 받아 D1 에 적는다 (제작자 2026-11-13 '클로드 콘솔 연결해서 실시간으로 달러 사용 현황').
// GitHub Actions ai-cost.yml 이 1시간마다 부른다. ANTHROPIC_ADMIN_KEY(Admin API 키)는 Actions 비밀값에만 있고 사이트 서버에는 넣지 않는다.
// 공개 실행 기록이라 금액도 찍지 않는다 ('ok' 와 오류 상태 코드만).
//
// 적는 것:
//  - ai_cost(month, usd, refreshed_at, fetched_at): 콘솔이 센 이번 달(UTC 달) 금액과 그 값이 언제까지의 사용인지(data_refreshed_at, 보통 4시간쯤 늦다)
//  - ai_snap(at, micro): 지금까지 앱이 센 AI 비용(api_usage, 마이크로 달러) — 사이트가 '콘솔 값 + 그 뒤 앱이 센 만큼'을 더할 때 refreshed_at 바로 앞 값을 쓴다
// 사이트 쪽은 server/apiUsage.ts monthUsd.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = process.env.ANTHROPIC_ADMIN_KEY;
if (!KEY) {
  console.log("ANTHROPIC_ADMIN_KEY 없음: 건너뜀");
  process.exit(0);
}
const DB = "sapphire-accounts";
const W = process.env.WRANGLER ?? "wrangler";

function d1(sql, json = false) {
  const dir = mkdtempSync(join(tmpdir(), "aicost-"));
  const file = join(dir, "q.sql");
  writeFileSync(file, sql);
  // web/wrangler.toml 을 읽지 않게 빈 폴더에서 부른다 (db-peek 과 같이)
  const out = execFileSync(W, ["d1", "execute", DB, "--remote", "--yes", ...(json ? ["--json"] : []), `--file=${file}`], { encoding: "utf8", cwd: dir });
  if (!json) return null;
  const j = JSON.parse(out.slice(out.search(/[[{]/)));
  return Array.isArray(j) ? j[0]?.results ?? [] : [];
}

const now = new Date();
const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const month = monthStart.toISOString().slice(0, 7);

// 콘솔: 이번 달 처음부터 지금까지 한 줄 합 (group_by 없음, time bucket 없음)
const url = `https://api.anthropic.com/v1/organizations/analytics/cost?starting_at=${encodeURIComponent(monthStart.toISOString().replace(".000", ""))}`;
const res = await fetch(url, {
  headers: { "x-api-key": KEY, "anthropic-version": "2026-10-21", "anthropic-beta": "analytics-usage-cost-2026-08-24" },
});
if (!res.ok) {
  console.log(`콘솔 비용 조회 실패: HTTP ${res.status}`);
  process.exit(1);
}
const body = await res.json();
const cents = (body.data ?? []).reduce((t, r) => t + Number(r?.cost?.amount ?? 0), 0);
const refreshed = body.data_refreshed_at ? Date.parse(body.data_refreshed_at) : null;

const sqls = [
  "CREATE TABLE IF NOT EXISTS ai_cost (month TEXT PRIMARY KEY, usd REAL NOT NULL, refreshed_at INTEGER, fetched_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS ai_snap (at INTEGER PRIMARY KEY, micro INTEGER NOT NULL);",
  // 지금까지 앱이 센 값 (식은 server/apiUsage.ts USD_MICRO_SQL 과 같게)
  `INSERT OR REPLACE INTO ai_snap (at, micro) SELECT ${Date.now()}, CAST(ROUND(COALESCE(SUM(input * 4 + cache_write * 5 + cache_read * 0.2 + output * 20 + web * 10000), 0)) AS INTEGER) FROM api_usage;`,
];
// 아직 이번 달 집계가 없으면(data_refreshed_at null) 콘솔 값은 적지 않는다 (사이트가 앱 어림값으로 대신한다)
if (refreshed !== null) {
  sqls.push(`INSERT OR REPLACE INTO ai_cost (month, usd, refreshed_at, fetched_at) VALUES ('${month}', ${(cents / 100).toFixed(6)}, ${refreshed}, ${Date.now()});`);
}
d1(sqls.join("\n"));
console.log(refreshed === null ? "ok (이번 달 콘솔 집계 아직 없음)" : "ok");
