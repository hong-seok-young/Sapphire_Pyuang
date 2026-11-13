// 둘째 Cloudflare 계정에 사용 기록 DB 와 일꾼을 올리고 사이트에 주소·열쇠를 넣는다 (제작자 2026-11-14 '사용 기록 쪽에서 쓰는 건 새로운 계정으로 옮겨').
// deploy-web.yml 'Log worker' 와 log-worker.yml(손으로 시험)이 부른다. 비밀값 CF2_API_TOKEN·CF2_ACCOUNT_ID 가 없으면 아무것도 안 한다.
//  1. 둘째 계정에 D1 sapphire-log-r1 (없으면 아시아에 만든다), workers.dev 주소(없으면 만든다)
//  2. web/logworker 를 올리고 열쇠 LOG_KEY 를 넣는다 (열쇠는 CF2_API_TOKEN 에서 만든 값이라 배포마다 같다)
//  3. 일꾼이 답하면 사이트(Pages, 첫째 계정)에 LOG_REMOTE_URL·LOG_REMOTE_KEY 를 넣는다. 그다음 사이트 배포부터 새 사용 기록이 둘째 계정에 쌓인다 (server/logdb.ts)
// 공개 실행 기록이라 주소·열쇠는 찍지 않는다.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const tok = process.env.CF2_API_TOKEN;
const acc = process.env.CF2_ACCOUNT_ID;
if (!tok || !acc) {
  console.log("둘째 계정 비밀값이 없어서 사용 기록은 첫째 계정에 그대로 써요");
  process.exit(0);
}
const api = async (path, init = {}) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  return r.json();
};

// 1. DB
let db = (await api("/d1/database?name=sapphire-log-r1")).result?.find((d) => d.name === "sapphire-log-r1")?.uuid;
if (!db) {
  const made = await api("/d1/database", { method: "POST", body: JSON.stringify({ name: "sapphire-log-r1", primary_location_hint: "apac" }) });
  db = made.result?.uuid;
  if (!db) throw new Error("둘째 계정에 DB 를 못 만들었어요: " + JSON.stringify(made.errors ?? made).slice(0, 300));
  console.log("둘째 계정에 사용 기록 DB 를 만들었어요");
}
const tomlPath = "logworker/wrangler.toml";
writeFileSync(tomlPath, readFileSync(tomlPath, "utf8").replace(/database_id = "[^"]*"/, `database_id = "${db}"`));

// workers.dev 주소
let sub = (await api("/workers/subdomain")).result?.subdomain;
if (!sub) {
  const want = "sapphire-" + createHash("sha256").update(acc).digest("hex").slice(0, 8);
  const made = await api("/workers/subdomain", { method: "PUT", body: JSON.stringify({ subdomain: want }) });
  sub = made.result?.subdomain;
  if (!sub) throw new Error("workers.dev 주소를 못 만들었어요: " + JSON.stringify(made.errors ?? made).slice(0, 300));
  console.log("둘째 계정에 workers.dev 주소를 만들었어요");
}

// 2. 일꾼
const key = createHash("sha256").update(tok + ":sapphire-log").digest("hex");
const env2 = { ...process.env, CLOUDFLARE_API_TOKEN: tok, CLOUDFLARE_ACCOUNT_ID: acc };
const wr = (args, input, env = env2) => execFileSync("npx", ["wrangler", ...args], { env, input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] }).toString();
try {
  wr(["deploy", "--config", tomlPath]);
  wr(["secret", "put", "LOG_KEY", "--config", tomlPath], key);
} catch (e) {
  console.log(String(e.stdout ?? "").slice(-1500), String(e.stderr ?? "").slice(-1500));
  throw new Error("사용 기록 일꾼을 못 올렸어요");
}
const url = `https://sapphire-log.${sub}.workers.dev`;

// 3. 답하는지 (새 workers.dev 주소는 퍼지는 데 조금 걸린다)
let ok = false;
for (let i = 0; i < 24 && !ok; i++) {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-log-key": key },
      body: JSON.stringify({ batch: [{ sql: "SELECT 1 AS one", params: [] }] }),
    });
    ok = r.ok && (await r.json())?.[0]?.results?.[0]?.one === 1;
  } catch {
    // 아직
  }
  if (!ok) await new Promise((r) => setTimeout(r, 5000));
}
if (!ok) throw new Error("사용 기록 일꾼이 답하지 않아요 (2분 기다림)");
console.log("사용 기록 일꾼이 답해요");
wr(["pages", "secret", "put", "LOG_REMOTE_URL", "--project-name", "sapphire-guild"], url, process.env);
wr(["pages", "secret", "put", "LOG_REMOTE_KEY", "--project-name", "sapphire-guild"], key, process.env);
console.log("사이트에 둘째 계정 사용 기록 주소를 넣었어요 (다음 사이트 배포부터 새 사용 기록이 둘째 계정에 쌓여요)");
