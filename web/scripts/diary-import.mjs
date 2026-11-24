// 비공개 일지 (server/diary.ts): 비공개 자료 길드/일지_기록.json 의 줄을 diary_runs·diary_shots 에 한 번씩 넣는다.
// 세션(Claude)이 사용자가 준 스샷을 직접 읽어 적은 기록을 올릴 때 쓴다 (AI API 를 부르지 않는다). 줄마다 key 로 setup 'diary_imp_<key>' 에 적어 두 번 넣지 않는다.
// 배포(deploy-web.yml 'Private viewers')가 부른다. 실행 기록이 공개라 아무것도 찍지 않는다.
// 줄 모양: { key, day, author, lv_from, exp_from, t_from, lv_to, exp_to, t_to, rate?(이 줄만 1%당 원), from: '이미지/…', to: '이미지/…' }
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATA = process.env.SAPPHIRE_DATA ?? join(process.cwd(), "..", "자료");
const LIST = join(DATA, "길드", "일지_기록.json");
const DB = "sapphire-accounts";
const CHUNK = 40_000;
const local = process.argv.includes("--local");
const where = local ? ["--local", ...(process.env.D1_PERSIST ? ["--persist-to", process.env.D1_PERSIST] : [])] : ["--remote"];

const q = (s) => "'" + String(s ?? "").replace(/'/g, "''") + "'";
const n = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? "NULL" : String(Number(v)));
const run = (...args) => execFileSync("npx", ["wrangler", "d1", "execute", DB, ...where, "--yes", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const json = (out) => JSON.parse(out.slice(out.indexOf("[")));

if (existsSync(LIST)) {
  const rows = JSON.parse(readFileSync(LIST, "utf8"));
  const done = new Set(
    (json(run("--json", "--command", "SELECT key FROM setup WHERE key LIKE 'diary_imp_%'"))[0]?.results ?? []).map((r) => r.key),
  );
  const dir = mkdtempSync(join(tmpdir(), "dy-"));
  for (const r of rows) {
    const key = "diary_imp_" + String(r.key).replace(/[^\w-]/g, "");
    if (!r.key || done.has(key)) continue;
    const at = Date.parse(`${r.day}T12:00:00+09:00`) || Date.now();
    const id = `(SELECT MAX(id) FROM diary_runs WHERE author = ${q(r.author)} AND created_at = ${at})`;
    const lines = [
      `INSERT INTO diary_runs (author, day, lv_from, exp_from, t_from, lv_to, exp_to, t_to, rate, created_at, updated_at) VALUES (${q(r.author)}, ${q(r.day)}, ${n(r.lv_from)}, ${n(r.exp_from)}, ${q(r.t_from)}, ${n(r.lv_to)}, ${n(r.exp_to)}, ${q(r.t_to)}, ${n(r.rate)}, ${at}, ${at});`,
    ];
    for (const side of ["from", "to"]) {
      const p = r[side] && join(DATA, r[side]);
      if (!p || !existsSync(p)) continue;
      const bytes = readFileSync(p);
      const type = p.endsWith(".webp") ? "image/webp" : p.endsWith(".png") ? "image/png" : "image/jpeg";
      lines.push(`INSERT INTO diary_shots (run_id, side, type, size, data, created_at) VALUES (${id}, '${side}', '${type}', ${bytes.length}, X'', ${at});`);
      for (let i = 0; i < bytes.length; i += CHUNK)
        lines.push(`UPDATE diary_shots SET data = CAST(data || X'${bytes.subarray(i, i + CHUNK).toString("hex")}' AS BLOB) WHERE run_id = ${id} AND side = '${side}';`);
    }
    lines.push(`INSERT OR REPLACE INTO setup (key, done_at) VALUES (${q(key)}, ${Date.now()});`);
    const file = join(dir, key + ".sql");
    writeFileSync(file, lines.join("\n"));
    run("--file", file);
  }
}
