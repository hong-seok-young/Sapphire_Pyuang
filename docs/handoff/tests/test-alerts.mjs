// Local test of notifications (/api/alerts) against `wrangler pages dev` and the LOCAL D1 only.
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
const people = ["알림판매", "알림손님", "알림손님2"];

try {
  check("server up", await up());
  const admin = (await req("POST", "/api/login", { id: "localtest", password: devPassword })).cookie;
  for (const id of people) {
    await req("DELETE", `/api/users/${enc(id)}`, null, admin);
    await req("POST", "/api/users", { id, role: "member", password: "local-al-1" }, admin);
  }
  const login = async (id) => {
    const r = await req("POST", "/api/login", { id, password: "local-al-1" });
    await req("POST", "/api/password", { current: "local-al-1", next: "local-al-2" }, r.cookie);
    return r.cookie;
  };
  const s = await login("알림판매");
  const b = await login("알림손님");
  const c = await login("알림손님2");
  const base = { category: "반지", enhance: 0, enchant: null, enchantValue: null, qty: 1, note: null };
  const sale = (await req("POST", "/api/market", { ...base, item: "고대의반지", price: 3000 }, s)).json;
  const auc = (await req("POST", "/api/market", { ...base, item: "약속의반지", price: 1000, mode: "auction", hours: 12 }, s)).json;
  await req("PUT", `/api/market/${sale.id}/want`, { note: null, offer: 2500 }, b);
  await req("POST", `/api/market/${auc.id}/bids`, { amount: 1000 }, b);
  await req("POST", `/api/market/${auc.id}/bids`, { amount: 1200 }, c);

  const sa = (await req("GET", "/api/alerts", null, s)).json;
  const texts = (sa?.alerts ?? []).map((a) => a.text);
  check("seller gets the want with the offer", texts.some((t) => t.includes("알림손님님이 고대의반지 살래요") && t.includes("흥정 2,500골드")), texts.join(" | "));
  check("seller gets both bids", texts.filter((t) => t.includes("약속의반지 경매에")).length === 2);
  check("count matches", (await req("GET", "/api/alerts/count", null, s)).json?.unread === sa?.unread && sa.unread === 3, String(sa?.unread));
  const bt = ((await req("GET", "/api/alerts", null, b)).json?.alerts ?? []).map((a) => a.text);
  check("outbid bidder is told (no name)", bt.length === 1 && bt[0].includes("더 높은 입찰") && !bt[0].includes("알림손님2"), bt.join(" | "));
  check("new listings are off by default", !bt.some((t) => t.includes("올림")));
  check("read all", (await req("POST", "/api/alerts", null, s)).status === 200 && (await req("GET", "/api/alerts/count", null, s)).json?.unread === 0);

  check("bad pref -> 400", (await req("PUT", "/api/alerts/prefs", { kind: "nope", on: true }, s)).status === 400);
  await req("PUT", "/api/alerts/prefs", { kind: "market_want", on: false }, s);
  await req("PUT", "/api/alerts/prefs", { kind: "market_new", on: true }, b);
  await req("DELETE", `/api/market/${sale.id}/want`, null, c);
  await req("PUT", `/api/market/${sale.id}/want`, { note: null }, c);
  check("turned-off kind is not sent", (await req("GET", "/api/alerts/count", null, s)).json?.unread === 0);
  await req("POST", "/api/market", { ...base, item: "신비의반지", price: 500 }, s);
  const bt2 = ((await req("GET", "/api/alerts", null, b)).json?.alerts ?? []).map((a) => a.text);
  check("turned-on new listings arrive", bt2.some((t) => t.includes("신비의반지 올림")), bt2.join(" | "));
  check("prefs are returned", (await req("GET", "/api/alerts", null, b)).json?.prefs?.market_new === true);
  check("alerts need login", (await req("GET", "/api/alerts")).status === 401);

  await req("POST", "/api/requests", { title: "검은진액 5개", rewardGold: 1000 }, s);
  const rq = ((await req("GET", "/api/requests", null, b)).json?.requests ?? (await req("GET", "/api/requests", null, b)).json ?? []);
  const mine = (Array.isArray(rq) ? rq : []).find((q) => q.owner === "알림판매");
  if (mine) {
    await req("PATCH", `/api/requests/${mine.id}`, { action: "accept" }, b);
    check("request owner told about accept", ((await req("GET", "/api/alerts", null, s)).json?.alerts ?? []).some((a) => a.text.includes("수락")));
  } else check("request found", false);
} finally {
  try {
    const admin = (await req("POST", "/api/login", { id: "localtest", password: devPassword })).cookie;
    for (const id of people) await req("DELETE", `/api/users/${enc(id)}`, null, admin);
  } catch {}
  execSync(
    "powershell.exe -NoProfile -Command \"Get-CimInstance Win32_Process | Where-Object { ($_.Name -match 'node|workerd') -and ($_.CommandLine -match 'pages dev dist|workerd-windows-64') } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }\"",
    { stdio: "ignore" },
  );
}
process.exit(fails ? 1 : 0);
