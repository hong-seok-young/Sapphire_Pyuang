// Local test of the developer-only activity log (/api/activity, functions/api/_middleware.ts) against
// `wrangler pages dev` and the LOCAL D1 only.
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
async function req(method, path, body, cookie, ua) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}), ...(ua ? { "user-agent": ua } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] };
}
const enc = encodeURIComponent;
const APP_UA = "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile SapphireApp/1.16";

try {
  check("server up", await up());
  const admin = (await req("POST", "/api/login", { id: "localtest", password: devPassword })).cookie;
  await req("DELETE", `/api/users/${enc("기록멤버")}`, null, admin);
  await req("POST", "/api/users", { id: "기록멤버", role: "member", password: "local-log-1" }, admin);
  await req("POST", "/api/login", { id: "기록멤버", password: "local-log-wrong" }, null, APP_UA);
  const first = await req("POST", "/api/login", { id: "기록멤버", password: "local-log-1" }, null, APP_UA);
  const m = first.cookie;
  await req("POST", "/api/password", { current: "local-log-1", next: "local-log-new1" }, m, APP_UA);
  await req("GET", "/api/me", null, m, APP_UA);
  await req("GET", "/api/me", null, m, APP_UA);
  check("view is recorded", (await req("POST", "/api/activity", { path: "#/market" }, m, APP_UA)).status === 200);
  check("bad view path -> 400", (await req("POST", "/api/activity", { path: "javascript:x" }, m)).status === 400);
  const made = await req("POST", "/api/market", {
    item: "고대의반지", category: "반지", enhance: 0, enchant: "int", enchantValue: 1, qty: 1, price: 3_000_000, note: "비밀노트",
  }, m, APP_UA);
  await req("PATCH", `/api/market/${made.json?.id}`, { status: "sold" }, m, APP_UA);
  // 제작자 요청 (2026-10-31): 접속은 웹이나 앱을 새로 열 때 화면이 보내는 { open: true } 로만 센다 (30분 쉬기, /api/me 로는 안 센다)
  const visits = async () => ((await req("GET", `/api/activity?user=${enc("기록멤버")}&kind=visit`, null, admin)).json?.rows ?? []).length;
  check("/api/me and actions add no visit", (await visits()) === 0);
  check("open is recorded", (await req("POST", "/api/activity", { open: true }, m, APP_UA)).status === 200);
  check("member cannot read the log -> 403", (await req("GET", "/api/activity", null, m)).status === 403);
  check("log needs login -> 401", (await req("GET", "/api/activity")).status === 401);

  const log = (await req("GET", `/api/activity?user=${enc("기록멤버")}`, null, admin)).json;
  const rows = log?.rows ?? [];
  const kinds = rows.map((r) => r.kind);
  check("one visit, from the open", kinds.filter((k) => k === "visit").length === 1 && rows.some((r) => r.kind === "visit" && r.what === "open"), kinds.join(","));
  check("view saved with the path", rows.some((r) => r.kind === "view" && r.what === "#/market"));
  check("login, password change, listing and sold are actions", ["POST /api/login", "POST /api/password", "POST /api/market", `PATCH /api/market/${made.json?.id}`]
    .every((w) => rows.some((r) => r.kind === "act" && r.what === w)), rows.map((r) => r.what).join(" | "));
  const post = rows.find((r) => r.what === "POST /api/market");
  check("listing detail keeps item and price", post?.detail?.includes("고대의반지") && post.detail.includes("3000000"), post?.detail);
  const all = JSON.stringify(rows);
  // 제작자 요청 (2026-10-31): 비밀번호만 빼고 모두 남긴다
  check("note is in the log, no password is", all.includes("비밀노트") && !all.includes("local-log"), "");
  check("wrong login is logged without the password", rows.some((r) => r.what === "POST /api/login" && r.detail?.includes("failed")));
  check("device is recorded", rows.some((r) => typeof r.device === "string" && r.device.length > 0), rows[0]?.device);
  check("sold row names the listing", rows.find((r) => r.what.startsWith("PATCH"))?.detail?.includes("고대의반지 (기록멤버)"));
  check("via is app", rows.every((r) => r.via === "app"), rows.map((r) => r.via).join(","));
  const person = (log?.people ?? []).find((p) => p.id === "기록멤버");
  check("summary counts", person?.visits7 === 1 && person.views7 === 1 && person.acts7 >= 4 && person.lastVia === "app", JSON.stringify(person));
  check("filter by kind", ((await req("GET", `/api/activity?user=${enc("기록멤버")}&kind=view`, null, admin)).json?.rows ?? []).every((r) => r.kind === "view"));

  await req("DELETE", `/api/users/${enc("기록멤버")}`, null, admin);
  check("deleting the account deletes its log", ((await req("GET", `/api/activity?user=${enc("기록멤버")}`, null, admin)).json?.rows ?? []).length === 0);
  check("the admin's delete is logged", ((await req("GET", `/api/activity?user=localtest&kind=act`, null, admin)).json?.rows ?? [])
    .some((r) => r.what === `DELETE /api/users/기록멤버`));
} finally {
  execSync(
    "powershell.exe -NoProfile -Command \"Get-CimInstance Win32_Process | Where-Object { ($_.Name -match 'node|workerd') -and ($_.CommandLine -match 'pages dev dist|workerd-windows-64') } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }\"",
    { stdio: "ignore" },
  );
}
process.exit(fails ? 1 : 0);
