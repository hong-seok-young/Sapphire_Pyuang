// 자료 저장소 판이 배포됐는지 본다 (.github/workflows/data-watch.yml). 배포해야 하면 'data_try_<커밋>' 을 적고 0, 아니면 1 로 끝난다.
//   node scripts/data-watch.mjs <자료 저장소 커밋>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DB = "sapphire-accounts";
const sha = process.argv[2] ?? "";
if (!/^[0-9a-f]{40}$/.test(sha)) {
  console.log("커밋을 읽지 못했어요");
  process.exit(1);
}
const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const wrangler = (...args) => execFileSync(process.execPath, [WRANGLER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const parseJson = (text) => JSON.parse(text.slice(text.search(/[[{]/)));
const query = (sql) => parseJson(wrangler("d1", "execute", DB, "--remote", "--json", "--command", sql))[0]?.results ?? [];

// wrangler.toml 의 database_id 자리표시를 채운다 (scripts/ci-d1.mjs 와 같다)
const toml = readFileSync("wrangler.toml", "utf8");
if (/^database_id = "0{8}-/m.test(toml)) {
  const id = parseJson(wrangler("d1", "list", "--json")).find((d) => d.name === DB)?.uuid;
  if (!id) {
    console.log("계정 DB를 찾지 못했어요");
    process.exit(1);
  }
  writeFileSync("wrangler.toml", toml.replace(/^database_id = ".*"$/m, `database_id = "${id}"`));
}

const rows = query(`SELECT key, done_at FROM setup WHERE key IN ('data_ok_${sha}', 'data_try_${sha}')`);
if (rows.some((r) => r.key === `data_ok_${sha}`)) process.exit(1);
const tried = rows.find((r) => r.key === `data_try_${sha}`);
if (tried && Date.now() - tried.done_at < 90 * 60_000) process.exit(1);
query(`INSERT INTO setup (key, done_at) VALUES ('data_try_${sha}', ${Date.now()}) ON CONFLICT (key) DO UPDATE SET done_at = excluded.done_at`);
process.exit(0);
