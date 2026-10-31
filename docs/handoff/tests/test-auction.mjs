// Local test of broker offers (흥정), auctions (경매), the cash rate, and the admin '비밀번호 바꾸게 하기',
// against `wrangler pages dev` and the LOCAL D1 only.
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
const d1 = (command) => {
  const out = execSync(`npx wrangler d1 execute sapphire-accounts --local --json --command "${command}"`, {
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, encoding: "utf8",
  });
  return JSON.parse(out)[0]?.results ?? [];
};
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
const market = async (cookie) => (await req("GET", "/api/market", null, cookie)).json;
const find = async (cookie, id) => ((await market(cookie))?.listings ?? []).find((l) => l.id === id);
const bow = { item: "헌터보우", category: "주장비", enhance: 8, enchant: null, enchantValue: null, qty: 1, price: 3_000_000, note: null };

try {
  check("server up", await up());
  const admin = (await req("POST", "/api/login", { id: "localtest", password: devPassword })).cookie;
  const people = [["경매왕", "member", "local-a-1"], ["입찰일", "member", "local-a-2"], ["입찰이", "member", "local-a-3"], ["경매오피", "officer", "local-a-4"]];
  for (const [id, role, pw] of people) {
    await req("DELETE", `/api/users/${enc(id)}`, null, admin);
    await req("POST", "/api/users", { id, role, password: pw }, admin);
  }
  const login = async (id, first, next) => {
    const r = await req("POST", "/api/login", { id, password: first });
    await req("POST", "/api/password", { current: first, next }, r.cookie);
    return r.cookie;
  };
  const s = await login("경매왕", "local-a-1", "local-auc-pw1");
  const b1 = await login("입찰일", "local-a-2", "local-auc-pw2");
  const b2 = await login("입찰이", "local-a-3", "local-auc-pw3");
  const o = await login("경매오피", "local-a-4", "local-auc-pw4");

  // --- cash rate: average of open '골드 팝니다' offers, else 75 ---
  const avgNow = () => d1("SELECT AVG(rate) AS rate FROM gold_offers WHERE status = 'open' AND side = 'sell'")[0]?.rate ?? null;
  const expected = (avg) => (avg ? Math.round(avg * 10) / 10 : 75);
  check("gold rate matches open sell offers", (await market(b1))?.goldRate === expected(avgNow()), `${(await market(b1))?.goldRate}`);
  await req("POST", "/api/gold", { side: "sell", gold: 750, rate: 80, note: null }, s);
  await req("POST", "/api/gold", { side: "buy", gold: 750, rate: 60, note: null }, b1);
  check("buy offers do not count, sell offers do", (await market(b1))?.goldRate === expected(avgNow()), `${(await market(b1))?.goldRate} vs ${expected(avgNow())}`);

  // --- offers (흥정): only the seller sees them ---
  const sale = await req("POST", "/api/market", bow, s);
  check("sale listing is mode sale, no end", sale.status === 201 && sale.json?.mode === "sale" && sale.json?.endsAt === null, JSON.stringify(sale.json)?.slice(0, 160));
  const sid = sale.json?.id;
  for (const [why, offer] of [["zero", 0], ["negative", -5], ["not whole", 1.5], ["too big", 1e12], ["text", "250만"]]) {
    check(`bad offer: ${why} -> 400`, (await req("PUT", `/api/market/${sid}/want`, { note: null, offer }, b1)).status === 400);
  }
  const w1 = await req("PUT", `/api/market/${sid}/want`, { note: "8강 맞죠?", offer: 2_800_000 }, b1);
  check("buyer wants with an offer", w1.status === 200 && w1.json?.myOffer === 2_800_000 && w1.json?.wants === 1, JSON.stringify(w1.json));
  check("want without an offer still works", (await req("PUT", `/api/market/${sid}/want`, { note: null }, b2)).json?.myOffer === null);
  const bySeller = await find(s, sid);
  const offers = Object.fromEntries((bySeller?.wanters ?? []).map((w) => [w.id, w.offer]));
  check("seller sees each offer", offers["입찰일"] === 2_800_000 && offers["입찰이"] === null, JSON.stringify(bySeller?.wanters));
  const byBuyer = await find(b1, sid);
  check("buyer sees own offer only", byBuyer?.myOffer === 2_800_000 && !("wanters" in byBuyer));
  const byOther = await find(o, sid);
  check("others see no offers", byOther?.myOffer === null && !("wanters" in byOther) && !JSON.stringify(byOther).includes("2800000"));
  check("offer can be changed", (await req("PUT", `/api/market/${sid}/want`, { note: null, offer: 2_900_000 }, b1)).json?.myOffer === 2_900_000);
  check("taking 살래요 back drops the offer", (await req("DELETE", `/api/market/${sid}/want`, null, b1)).status === 200 && (await find(b1, sid))?.myOffer === null);
  check("bid on a sale listing -> 404", (await req("POST", `/api/market/${sid}/bids`, { amount: 3_000_000 }, b1)).status === 404);

  // --- auctions ---
  for (const [why, change] of [["no hours", { mode: "auction" }], ["odd hours", { mode: "auction", hours: 5 }], ["bad mode", { mode: "trade" }]]) {
    check(`bad auction: ${why} -> 400`, (await req("POST", "/api/market", { ...bow, ...change }, s)).status === 400);
  }
  const before = Date.now();
  const auc = await req("POST", "/api/market", { ...bow, price: 1_000_000, mode: "auction", hours: 24 }, s);
  const aid = auc.json?.id;
  check("auction posted with an end time", auc.status === 201 && auc.json?.mode === "auction" && Math.abs(auc.json?.endsAt - (before + 24 * 3_600_000)) < 60_000,
    JSON.stringify(auc.json)?.slice(0, 200));
  check("sale hours are ignored", (await req("POST", "/api/market", { ...bow, item: "숙련궁", mode: "sale", hours: 24 }, s)).json?.endsAt === null);
  check("want on an auction -> 400", (await req("PUT", `/api/market/${aid}/want`, { note: null }, b1)).status === 400);
  check("seller cannot bid -> 400", (await req("POST", `/api/market/${aid}/bids`, { amount: 2_000_000 }, s)).status === 400);
  check("below the start -> 400", (await req("POST", `/api/market/${aid}/bids`, { amount: 999_999 }, b1)).status === 400);
  check("bad amount -> 400", (await req("POST", `/api/market/${aid}/bids`, { amount: "백만" }, b1)).status === 400);
  const first = await req("POST", `/api/market/${aid}/bids`, { amount: 1_000_000 }, b1);
  check("first bid at the start price", first.status === 201 && first.json?.highestBid === 1_000_000 && first.json?.bidCount === 1 && first.json?.myBid === 1_000_000,
    JSON.stringify(first.json));
  check("same amount again -> 409", (await req("POST", `/api/market/${aid}/bids`, { amount: 1_000_000 }, b2)).status === 409);
  const second = await req("POST", `/api/market/${aid}/bids`, { amount: 1_050_000 }, b2);
  check("higher bid goes in", second.status === 201 && second.json?.highestBid === 1_050_000 && second.json?.bidCount === 2);
  check("lower than the top -> 409", (await req("POST", `/api/market/${aid}/bids`, { amount: 1_020_000 }, b1)).status === 409);
  check("outbid bidder bids again", (await req("POST", `/api/market/${aid}/bids`, { amount: 1_200_000 }, b1)).status === 201);
  // two bids at once: only one of the same amount can win
  const race = await Promise.all([
    req("POST", `/api/market/${aid}/bids`, { amount: 1_300_000 }, b1),
    req("POST", `/api/market/${aid}/bids`, { amount: 1_300_000 }, b2),
  ]);
  check("same amount at once: one in, one 409", race.map((r) => r.status).sort().join() === "201,409", race.map((r) => r.status).join());
  const v1 = await find(b1, aid);
  const v2 = await find(b2, aid);
  const vo = await find(o, aid);
  check("everyone sees the top and the count", [v1, v2, vo].every((v) => v?.highestBid === 1_300_000 && v?.bidCount === 4), `${vo?.highestBid} ${vo?.bidCount}`);
  check("each bidder sees own best bid", v1?.myBid === (race[0].status === 201 ? 1_300_000 : 1_200_000) && v2?.myBid === (race[1].status === 201 ? 1_300_000 : 1_050_000));
  check("non-bidder has no bid, nobody but the seller sees who", vo?.myBid === null && !("bids" in vo) && !("bids" in v1));
  const sv = await find(s, aid);
  check("seller sees all bids, highest first", sv?.bids?.length === 4 && sv.bids[0].amount === 1_300_000 && sv.bids.every((x, i, a) => i === 0 || a[i - 1].amount >= x.amount),
    JSON.stringify(sv?.bids));
  check("start price cannot change -> 400", (await req("PATCH", `/api/market/${aid}`, { price: 2_000_000 }, s)).status === 400);
  check("note can still change", (await req("PATCH", `/api/market/${aid}`, { note: "9시 거래" }, s)).json?.note === "9시 거래");

  // end it (as if 24 hours passed)
  d1(`UPDATE listings SET ends_at = ${Date.now() - 1000} WHERE id = ${aid}`);
  check("bid after the end -> 409", (await req("POST", `/api/market/${aid}/bids`, { amount: 5_000_000 }, b1)).status === 409);
  check("ended auction still listed for others", (await find(o, aid))?.mode === "auction");
  check("seller marks it sold", (await req("PATCH", `/api/market/${aid}`, { status: "sold" }, s)).json?.status === "sold");

  // bids go with the listing and with the bidder's account
  const auc2 = (await req("POST", "/api/market", { ...bow, price: 500_000, mode: "auction", hours: 12 }, s)).json?.id;
  await req("POST", `/api/market/${auc2}/bids`, { amount: 600_000 }, b2);
  await req("POST", `/api/market/${auc2}/bids`, { amount: 700_000 }, b1);
  await req("DELETE", `/api/users/${enc("입찰일")}`, null, admin);
  const left = await find(s, auc2);
  check("deleting a bidder removes their bids", left?.bidCount === 1 && left?.highestBid === 600_000, `${left?.bidCount} ${left?.highestBid}`);
  check("seller takes the auction down", (await req("DELETE", `/api/market/${auc2}`, null, s)).status === 200);
  check("its bids are gone", d1(`SELECT COUNT(*) AS n FROM listing_bids WHERE listing_id = ${auc2}`)[0]?.n === 0);

  // ('비밀번호 바꾸게 하기'는 제작자 요청으로 뺐다)
} finally {
  for (const [id] of [["경매왕"], ["입찰일"], ["입찰이"], ["경매오피"]]) {
    try { await req("DELETE", `/api/users/${enc(id)}`, null, (await req("POST", "/api/login", { id: "localtest", password: devPassword })).cookie); } catch {}
  }
  execSync(
    "powershell.exe -NoProfile -Command \"Get-CimInstance Win32_Process | Where-Object { ($_.Name -match 'node|workerd') -and ($_.CommandLine -match 'pages dev dist|workerd-windows-64') } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }\"",
    { stdio: "ignore" },
  );
}
process.exit(fails ? 1 : 0);
