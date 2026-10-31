// Seeds LOCAL data for looking at the broker offer/auction screens and the forced password page in the preview.
// Usage: node <this file> <local developer password file>   -- local throwaway values only, never printed.
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:8788";
const devPassword = readFileSync(process.argv[2], "utf8").trim();
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
const admin = (await req("POST", "/api/login", { id: "localtest", password: devPassword })).cookie;
const people = [["경매판매", "local-ui-1", "local-ui-new1"], ["흥정손님", "local-ui-2", "local-ui-new2"], ["비번시험", "local-ui-3", "local-ui-new3"]];
const cookies = {};
for (const [id, first, next] of people) {
  await req("DELETE", `/api/users/${enc(id)}`, null, admin);
  await req("POST", "/api/users", { id, role: "member", password: first }, admin);
  const r = await req("POST", "/api/login", { id, password: first });
  await req("POST", "/api/password", { current: first, next }, r.cookie);
  cookies[id] = r.cookie;
}
// old listings by localtest go away so the screens show only these
for (const l of (await req("GET", "/api/market", null, admin)).json?.listings ?? []) {
  if (l.seller === "localtest") await req("DELETE", `/api/market/${l.id}`, null, admin);
}
const base = { enhance: 0, enchant: null, enchantValue: null, qty: 1, note: null };
const s = cookies["경매판매"];
const c = cookies["흥정손님"];
const auc = (await req("POST", "/api/market", { ...base, item: "헌터보우", category: "주장비", enhance: 8, price: 1_000_000, mode: "auction", hours: 24 }, s)).json;
const sale = (await req("POST", "/api/market", { ...base, item: "고대의반지", category: "반지", enchant: "int", enchantValue: 1, price: 3_000_000, note: "급처해요" }, s)).json;
await req("POST", `/api/market/${auc.id}/bids`, { amount: 1_050_000 }, c);
const mySale = (await req("POST", "/api/market", { ...base, item: "숙련마법사옷", category: "갑옷", enhance: 6, price: 2_000_000 }, admin)).json;
const myAuc = (await req("POST", "/api/market", { ...base, item: "강화가죽벨트", category: "벨트", enchant: "str", enchantValue: 3, price: 500_000, mode: "auction", hours: 12 }, admin)).json;
await req("PUT", `/api/market/${mySale.id}/want`, { note: "오늘 밤 10시 어때요?", offer: 1_800_000 }, c);
await req("PUT", `/api/market/${mySale.id}/want`, { note: null }, s);
await req("POST", `/api/market/${myAuc.id}/bids`, { amount: 550_000 }, c);
await req("POST", `/api/market/${myAuc.id}/bids`, { amount: 600_000 }, s);
await req("POST", `/api/users/${enc("비번시험")}/must-change`, null, admin);
console.log("seeded", { auction: auc.id, sale: sale.id, mySale: mySale.id, myAuction: myAuc.id });
