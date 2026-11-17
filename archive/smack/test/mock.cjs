// 운영진 때리기 화면 시험: vite preview(dist) 위에 Playwright 로 /api 를 흉내 낸다
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:4173";
const DIR = __dirname;
const me = { id: "퓨앙", role: "developer", mustChange: false, job: "mage", level: 50, exp: 12000, guild: "main", avatar: null, createdAt: 1, characters: [{ id: "퓨앙", role: "developer", main: true }] };
const targets = [
  { id: "마을모금함", role: "master", job: "warrior", level: 52, avatar: 1 },
  { id: "멍멍", role: "officer", job: "ranger", level: 48, avatar: 2 },
  { id: "유어아너", role: "officer", job: "monk", level: 50, avatar: 3 },
  { id: "아홀로틀", role: "officer", job: "mage", level: 46, avatar: null },
  { id: "정서", role: "officer", job: "warrior", level: 44, avatar: null },
  { id: "향단", role: "officer", job: "ranger", level: 47, avatar: null },
];
const smack = {
  targets,
  mine: { "마을모금함": { hits: 320, damage: 41230, kos: 3, crits: 50, deadly: 9, best: 42 } },
  topTargets: [{ id: "마을모금함", hits: 5000, damage: 712000, kos: 61 }, { id: "멍멍", hits: 2100, damage: 301200, kos: 25 }, { id: "유어아너", hits: 900, damage: 120000, kos: 9 }, { id: "향단", hits: 300, damage: 40000, kos: 2 }],
  topHitters: [{ id: "현금술사", hits: 4000, damage: 560000, kos: 40, best: 180 }, { id: "퓨앙", hits: 1200, damage: 150000, kos: 12, best: 42 }, { id: "달팽이", hits: 500, damage: 61000, kos: 4, best: 30 }],
  hitMe: { hits: 120, damage: 15000, kos: 1, people: 3 },
};
module.exports = async function open(opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: opts.width || 360, height: opts.height || 740 }, deviceScaleFactor: opts.scale || 2, reducedMotion: opts.reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  await page.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) console.log("CONSOLE", m.text().slice(0, 200)); });
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
    if (p === "/api/me") return json(me);
    if (p === "/api/smack") return route.request().method() === "GET" ? json(opts.smack || smack) : json({ ok: true });
    if (p.startsWith("/api/avatar/")) {
      const id = decodeURIComponent(p.slice(12));
      const n = { "마을모금함": "av1.png", "멍멍": "av2.png", "유어아너": "av3.png" }[id];
      if (n) return route.fulfill({ status: 200, contentType: "image/png", body: fs.readFileSync(path.join(DIR, n)) });
      return route.fulfill({ status: 404, body: "" });
    }
    if (p === "/api/kakao") return json({ links: {}, high: ["마을모금함"] });
    if (p === "/api/news") return json({ counts: {}, things: [], maint: [] });
    if (p === "/api/alerts/count") return json({ count: 0 });
    if (p === "/api/layout") return json({ layout: null });
    if (p === "/api/activity") return json({ ok: true });
    return json({});
  });
  await page.route("**/data/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.startsWith("/data/smack/")) return route.fulfill({ status: 200, contentType: "image/png", body: fs.readFileSync(path.join("/home/user/sapphire-imo-data/이미지/때리기", path.basename(p).split("?")[0])) });
    return route.fulfill({ status: 404, body: "" });
  });
  return { browser, page, BASE };
};
