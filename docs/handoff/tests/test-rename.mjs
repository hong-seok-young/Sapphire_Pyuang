// Local test of nickname change (/api/users/:id/rename) against `wrangler pages dev` and the LOCAL D1 only.
// Usage (cwd = web, after a build): node <this file> <local developer password file>   -- local throwaway values only, never printed.
import { execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:8788";
const devPassword = readFileSync(process.argv[2], "utf8").trim();
let fails = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);
  if (!ok) fails++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const d1 = (command) =>
  JSON.parse(execSync(`npx wrangler d1 execute sapphire-accounts --local --json --command "${command}"`, {
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, encoding: "utf8",
  }))[0]?.results ?? [];
const server = spawn("npx", ["wrangler", "pages", "dev", "dist", "--port", "8788", "--ip", "127.0.0.1"], {
  shell: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" }, stdio: "ignore",
});
async function up() {
  for (let i = 0; i < 90; i++) {
    try { await fetch(BASE + "/api/me"); return true; } catch { await wait(1000); }
  }
  return false;
}
async function req(method, path, body, cookie) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] };
}
const enc = encodeURIComponent;
const names = ["옛닉", "새닉", "새닉2", "옆사람", "옆사람2", "이름오피", "있는닉"];

try {
  check("server up", await up());
  const admin = (await req("POST", "/api/login", { id: "localtest", password: devPassword })).cookie;
  for (const n of names) await req("DELETE", `/api/users/${enc(n)}`, null, admin);
  for (const [id, role] of [["옛닉", "member"], ["옆사람", "member"], ["이름오피", "officer"], ["있는닉", "member"]]) {
    await req("POST", "/api/users", { id, role, password: "local-rn-1" }, admin);
  }
  const login = async (id) => {
    const r = await req("POST", "/api/login", { id, password: "local-rn-1" });
    await req("POST", "/api/password", { current: "local-rn-1", next: "local-rn-2" }, r.cookie);
    return r.cookie;
  };
  const a = await login("옛닉");
  const b = await login("옆사람");
  const o = await login("이름오피");
  await req("PUT", "/api/profile", { job: "mage", level: 30, exp: 12345, guild: "main" }, a);
  await req("PUT", "/api/profile", { job: "mage", level: 31, exp: 0, guild: "main" }, a);
  const listing = (await req("POST", "/api/market", { item: "고대의반지", category: "반지", enhance: 0, enchant: null, enchantValue: null, qty: 1, price: 1000, note: null }, a)).json;
  const theirs = (await req("POST", "/api/market", { item: "헌터보우", category: "주장비", enhance: 0, enchant: null, enchantValue: null, qty: 1, price: 500, mode: "auction", hours: 12, note: null }, b)).json;
  await req("POST", `/api/market/${theirs.id}/bids`, { amount: 600 }, a);
  await req("PUT", `/api/market/${listing.id}/want`, { note: null }, b);
  await req("POST", "/api/requests", { title: "검은진액 10개", rewardGold: 1000 }, a);

  check("bad nickname -> 400", (await req("POST", `/api/users/${enc("옛닉")}/rename`, { newId: "<b>" }, a)).status === 400);
  check("same nickname -> 400", (await req("POST", `/api/users/${enc("옛닉")}/rename`, { newId: "옛닉" }, a)).status === 400);
  check("taken nickname -> 409", (await req("POST", `/api/users/${enc("옛닉")}/rename`, { newId: "있는닉" }, a)).status === 409);
  check("another member cannot -> 403", (await req("POST", `/api/users/${enc("옛닉")}/rename`, { newId: "새닉" }, b)).status === 403);
  check("officer cannot rename the developer -> 403", (await req("POST", `/api/users/localtest/rename`, { newId: "새닉" }, o)).status === 403);

  const r1 = await req("POST", `/api/users/${enc("옛닉")}/rename`, { newId: "새닉" }, a);
  check("rename self", r1.status === 200 && r1.json?.id === "새닉" && r1.json?.fresh === false, JSON.stringify(r1.json));
  check("still logged in as the new name", (await req("GET", "/api/me", null, a)).json?.id === "새닉");
  check("old name cannot log in", (await req("POST", "/api/login", { id: "옛닉", password: "local-rn-2" })).status === 401);
  check("new name logs in", (await req("POST", "/api/login", { id: "새닉", password: "local-rn-2" })).status === 200);
  const mkt = (await req("GET", "/api/market", null, b)).json?.listings ?? [];
  check("listing follows", mkt.find((l) => l.id === listing.id)?.seller === "새닉");
  check("bid follows", (await req("GET", "/api/market", null, b)).json?.listings.find((l) => l.id === theirs.id)?.bids?.[0]?.id === "새닉");
  check("want on their listing seen by seller", (await req("GET", "/api/market", null, a)).json?.listings.find((l) => l.id === listing.id)?.wanters?.[0]?.id === "옆사람");

  const r2 = await req("POST", `/api/users/${enc("새닉")}/rename`, { newId: "새닉2", fresh: true, job: "ranger", level: 60, exp: 500, guild: "second" }, a);
  check("switched character", r2.status === 200 && r2.json?.fresh === true, JSON.stringify(r2.json));
  const me = (await req("GET", "/api/me", null, a)).json;
  check("profile is the new character", me?.id === "새닉2" && me.job === "ranger" && me.level === 60 && me.guild === "second", JSON.stringify(me));
  const growth = (await req("GET", "/api/growth?period=day", null, a)).json;
  const mine = JSON.stringify(growth ?? {}).includes("새닉2") ? JSON.stringify(growth).match(/"id":"새닉2"[^}]*/)?.[0] : "absent";
  check("no growth spike today", !/"growth":[1-9]/.test(mine ?? ""), mine);
  check("officer cannot switch someone's character -> 400",
    (await req("POST", `/api/users/${enc("옆사람")}/rename`, { newId: "옆사람2", fresh: true, job: "mage", level: 10 }, o)).status === 400);
  check("officer renames a member", (await req("POST", `/api/users/${enc("옆사람")}/rename`, { newId: "옆사람2" }, o)).json?.id === "옆사람2");
  check("member is still logged in", (await req("GET", "/api/me", null, b)).json?.id === "옆사람2");
  // 로컬 DB 를 직접 보는 확인은 맨 끝에 (서버가 도는 중에 DB 를 열고 바로 요청하면 로컬 서버가 끊길 때가 있다)
  check("request follows (both renames)", d1("SELECT COUNT(*) AS n FROM requests WHERE owner = '새닉2'")[0]?.n === 1);
  check("nothing under the middle name either", d1("SELECT COUNT(*) AS n FROM level_log WHERE user_id = '새닉'")[0]?.n === 0);
  check("nothing left under the old name", ["sessions", "profiles", "level_log", "listings"].every((t) =>
    d1(`SELECT COUNT(*) AS n FROM ${t} WHERE ${t === "listings" ? "seller" : "user_id"} = '옛닉'`)[0]?.n === 0));
  check("growth restarts from the new level", JSON.stringify(d1("SELECT level FROM level_log WHERE user_id = '새닉2'")) === JSON.stringify([{ level: 60 }]));
} finally {
  try {
    const admin = (await req("POST", "/api/login", { id: "localtest", password: devPassword })).cookie;
    for (const n of names) await req("DELETE", `/api/users/${enc(n)}`, null, admin);
  } catch {}
  execSync(
    "powershell.exe -NoProfile -Command \"Get-CimInstance Win32_Process | Where-Object { ($_.Name -match 'node|workerd') -and ($_.CommandLine -match 'pages dev dist|workerd-windows-64') } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }\"",
    { stdio: "ignore" },
  );
}
process.exit(fails ? 1 : 0);
