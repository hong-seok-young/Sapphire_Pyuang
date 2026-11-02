// 화면 폭 대원칙 검사 (CLAUDE.md '화면 폭 대원칙', 제작자 요청 2026-11-02): 모든 화면을 여러 폰 폭으로 열어
// 화면 밖으로 나가거나, 부모 칸 밖으로 삐져나오거나, 글자가 칸을 넘는 것을 찾는다. 칸 고르기 단추와 줄 펼침·팝업·대화창·폼도 하나씩 열어 본다.
// 쓰는 법: 로컬에서 `npx wrangler pages dev dist --port 8788` 을 띄우고 (로컬 D1 에 앱개발자 계정이 있어야 한다)
//   BASE=http://127.0.0.1:8788 ID=아이디 PW=비밀번호 node scripts/check-width.cjs [320,360,384,412]
// Playwright 가 필요하다 (Claude 클라우드 세션에는 깔려 있다). 무엇을 바꾸는 단추(삭제, 수락, 저장 …)는 누르지 않는다.
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://127.0.0.1:8788";
const ID = process.env.ID || "";
const PW = process.env.PW || "";
const WIDTHS = (process.argv[2] || "320,360,384,412").split(",").map(Number);
const SEEDS = ["#/", "#/info", "#/board", "#/board?cat=imo&t=all", "#/market", "#/requests", "#/ranking", "#/shop", "#/admin", "#/me", "#/alerts",
  "#/chat", "#/chat/list", "#/todo", "#/rent", "#/rent?v=apps", "#/rent?v=staff", "#/log", "#/gaps", "#/patch", "#/odds", "#/search", "#/places", "#/app", "#/match"];
/** 칸 고르기 단추 */
const TABS = ".sub-tabs button, .main-tabs > *, .pill-row > button, .filter > button, .mk-cats > button, .rank-tabs button, .tabs button";
/** 누르면 무엇이 바뀌는 단추: 누르지 않는다 */
const DENY = /삭제|거절|반납$|내리기|취소|로그아웃|보내기|수락|완료|^신청$|저장|초기화|통합|해제|지정|끄기|나가기|차감|적립|구매|등록$|올리기|경매 전환|살래요|팔래요|입찰|다시 답하기|새 대화|테스트|내 계정|전환|복구|기록 삭제|숨김|추가$|적용|다듬기|되돌리기/;
/** 누르면 칸이 펼쳐지거나 폼이 열리는 단추 */
const OPEN = /^(대화|정보 수정|성장 기록|팔기|물건 추가|글쓰기|✏️ 글쓰기|\+ 할 일 추가|반납 신청|대여 등록|수정|캐릭터 추가|기부 현황|장비대여( \d+)?|장비반납( \d+)?|예산|정산|설정|구매자|아이템|기록|대여 신청|골드|사기|내 판매|💬 토론방|토론방|닉네임 변경|비밀번호 바꾸기|알림 설정|함께|개발 중.*|더 보기)$/;
const OPENERS = "[aria-expanded='false'], .mk-item, .rent-li, .todo-row, button, a.pill";

/** 브라우저 안에서 도는 검사 */
const detect = () => {
  window.scrollTo(0, window.scrollY);
  const vw = document.documentElement.clientWidth;
  const desc = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".") : "";
    const txt = (el.innerText || el.value || el.placeholder || "").replace(/\s+/g, " ").trim().slice(0, 24);
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${txt ? ` "${txt}"` : ""}`;
  };
  const clipAncestor = (el) => {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== "visible") return a;
    }
    return null;
  };
  const hits = [];
  const flagged = new Set();
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.display === "contents") continue;
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const abs = cs.position === "absolute" || cs.position === "fixed";
    let why = null;
    const clip = clipAncestor(el);
    const cr = clip ? clip.getBoundingClientRect() : null;
    const visRight = cr ? Math.min(r.right, cr.right) : r.right;
    const visLeft = cr ? Math.max(r.left, cr.left) : r.left;
    if (cr && r.right > cr.right + 2 && clip !== document.body && getComputedStyle(clip).overflowX === "hidden" && !el.closest(".fit-line, .maint, .rank-row") && r.left < cr.right) why = `잘림 +${Math.round(r.right - cr.right)}px`;
    else if (visRight > vw + 1) why = `화면 밖 +${Math.round(visRight - vw)}px`;
    else if (visLeft < -1) why = `화면 왼쪽 밖 ${Math.round(visLeft)}px`;
    else if (!abs && el.parentElement && el.parentElement !== document.body) {
      const p = el.parentElement;
      const pcs = getComputedStyle(p);
      const pr = p.getBoundingClientRect();
      const inner = pr.right - parseFloat(pcs.borderRightWidth || "0");
      // 줄 끝의 빈칸(pre-wrap)은 보이지 않으니 글자 조각이 몇 px 나간 것은 넘침이 아니다
      const hang = cs.display === "inline" && r.right - inner < 8;
      if (pcs.overflowX === "visible" && r.right > inner + 2 && pcs.display !== "inline" && !hang) why = `부모 밖 +${Math.round(r.right - inner)}px`;
    }
    // 한 줄에 맞추려고 글자를 가장 작게 줄였는데도 잘린 이름 (FitLine, overflow hidden)
    if (!why && el.classList.contains("fit-line") && el.scrollWidth > el.clientWidth + 1) why = `글자 잘림 +${el.scrollWidth - el.clientWidth}px`;
    if (!why && !abs && cs.overflowX === "visible" && el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && cs.display !== "inline") {
      why = `글자 넘침 +${el.scrollWidth - el.clientWidth}px`;
    }
    if (!why) continue;
    // 바깥 것만 (조상이 이미 걸렸으면 뺀다)
    let a = el.parentElement, dup = false;
    while (a) { if (flagged.has(a)) { dup = true; break; } a = a.parentElement; }
    flagged.add(el);
    if (!dup) hits.push(`${why}: ${desc(el)}`);
  }
  return { scroll: document.documentElement.scrollWidth - vw, hits: hits.slice(0, 12) };
};

(async () => {
  const b = await chromium.launch();
  const found = new Map();
  let checks = 0;
  const add = (key, w, res) => {
    checks++;
    if (!res.hits.length && res.scroll <= 0) return;
    if (!found.has(key)) found.set(key, []);
    found.get(key).push(`  ${w}px 가로 넘침 ${res.scroll}px: ${res.hits.join(" | ")}`);
  };
  let routes = [...SEEDS];
  for (const [wi, w] of WIDTHS.entries()) {
    const ctx = await b.newContext({ viewport: { width: w, height: 800 } });
    const p = await ctx.newPage();
    await p.goto(BASE + "/");
    await p.evaluate(async ([id, pw]) => {
      localStorage.setItem(`sapphire.openingNever.${id}`, "1");
      await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, password: pw }) });
    }, [ID, PW]);
    const seen = new Set(routes);
    const perShape = new Map();
    for (let i = 0; i < routes.length && i < 140; i++) {
      const r = routes[i];
      await p.goto(BASE + "/" + r).catch(() => {});
      await p.waitForTimeout(i < 3 ? 1800 : 1100);
      add(r, w, await p.evaluate(`(${detect})()`));
      // 첫 폭에서 화면 목록을 모은다 (같은 모양의 주소는 2개까지)
      if (wi === 0) {
        for (const h of await p.$$eval("a[href^='#/']", (as) => as.map((a) => a.getAttribute("href")))) {
          if (seen.has(h) || /#\/as\//.test(h)) continue;
          const sh = h.replace(/\?.*/, "").split("/").slice(0, 2).join("/") + (h.split("/").length > 2 ? "/:x" : "") + (h.includes("?") ? "?" : "");
          if ((perShape.get(sh) ?? 0) >= 2) continue;
          perShape.set(sh, (perShape.get(sh) ?? 0) + 1);
          seen.add(h);
          routes.push(h);
        }
      }
      // 칸 고르기 단추를 하나씩
      const tabs = await p.$$eval(TABS, (bs) => bs.map((x, j) => ({ j, t: (x.innerText || "").replace(/\s+/g, " ").trim() })));
      for (const t of tabs.slice(0, 14)) {
        if (!t.t || DENY.test(t.t)) continue;
        const el = (await p.$$(TABS))[t.j];
        if (!el) continue;
        await el.click({ timeout: 1500 }).catch(() => {});
        await p.waitForTimeout(500);
        add(`${r} [${t.t.slice(0, 14)}]`, w, await p.evaluate(`(${detect})()`));
      }
      // 줄 펼침, 팝업, 대화창, 폼을 하나씩 (처음 화면들만: 같은 모양 주소는 한 번)
      if (i >= SEEDS.length) continue;
      const openers = await p.$$eval(OPENERS, (els, src) => {
        const re = new RegExp(src);
        let rows = 0;
        return els.flatMap((e, j) => {
          const t = (e.innerText || "").replace(/\s+/g, " ").trim();
          const row = e.matches("[aria-expanded='false'], .mk-item, .rent-li, .todo-row");
          if (row && rows++ >= 4) return [];
          return row || re.test(t) ? [{ j, t: t.slice(0, 16) }] : [];
        });
      }, OPEN.source);
      for (const o of openers.slice(0, 16)) {
        await p.goto(BASE + "/" + r).catch(() => {});
        await p.waitForTimeout(900);
        const el = (await p.$$(OPENERS))[o.j];
        if (!el) continue;
        await el.click({ timeout: 1500 }).catch(() => {});
        await p.waitForTimeout(700);
        add(`${r} > "${o.t}"`, w, await p.evaluate(`(${detect})()`));
      }
    }
    await ctx.close();
  }
  await b.close();
  console.log(`화면 ${routes.length}개, 폭 ${WIDTHS.join("/")}px, 검사 ${checks}번`);
  if (!found.size) console.log("넘침 없음");
  for (const [k, v] of found) console.log(k + "\n" + v.join("\n"));
  process.exitCode = found.size ? 1 : 0;
})().catch((e) => {
  console.error(e.message.split("\n")[0]);
  process.exit(2);
});
