// 아이모 사기꾼 명단 (제작자 2026-11-11 '거래 전 더치트 조회 & 실물 확인! 사기꾼 리스트 정리한다, 이것도 우리 DB 에 넣고 여기 내용 업데이트되면 반영').
// 원본은 카카오 오픈프로필 포스트(bit.ly/47c9kbQ -> open.kakao.com/p/…, Made by. 시리온 암)의 표 그림 하나다. 웹에서는 포스트 글은 못 읽고
// og:image(표 그림)와 og:title 만 보인다. 그래서 그림 주소가 바뀌면(포스트를 고치면 새 그림이 올라간다) 그 그림을 Claude 로 옮겨 계정 DB(D1) scam_list 에 넣는다.
//   node scripts/scam-list.mjs                 일주일에 한 번 (scam-list.yml, 제작자 '30분 너무 짧음'): 그림이 바뀌었으면 옮겨 넣는다 (made 'ai'), 앱개발자에게 알림
//   node scripts/scam-list.mjs --seed <json>   배포 (deploy-web.yml): 비공개 자료 링크/사기꾼_명단/명단.json(사람이 옮긴 것)을 넣는다.
//                                              DB 가 비었거나 같은 그림이면 넣고, DB 가 더 새 그림(AI 가 옮긴 것)이면 그대로 둔다
//   --local (D1_PERSIST=<persist 폴더>)       로컬 시험
// 사람 이름·계좌가 든 자료라 공개 실행 기록에는 개수만 찍는다.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DB = "sapphire-accounts";
const POST = "https://open.kakao.com/p/skq6nFDlNPtfT3GJqOk";
const MODEL = "claude-opus-5-5";
const where = process.argv.includes("--local") ? "--local" : "--remote";
const persist = where === "--local" && process.env.D1_PERSIST ? [`--persist-to=${process.env.D1_PERSIST}`] : [];
const seedAt = process.argv.indexOf("--seed");
const seedFile = seedAt > 0 ? process.argv[seedAt + 1] : "";

const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const wrangler = (...args) => {
  try {
    return execFileSync(process.execPath, [WRANGLER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  } catch {
    console.log("wrangler d1 execute 가 실패했어요");
    process.exit(1);
  }
};
const parseJson = (text) => JSON.parse(text.slice(text.search(/[[{]/)));
const query = (sql) => parseJson(wrangler("d1", "execute", DB, where, ...persist, "--json", "--command", sql))[0]?.results ?? [];
const q = (s) => (s === null || s === undefined ? "NULL" : typeof s === "number" ? String(s) : "'" + String(s).replace(/'/g, "''") + "'");
const runSql = (lines) => {
  const file = join(tmpdir(), `scam-list-${process.pid}-${Date.now()}.sql`);
  writeFileSync(file, lines.join("\n") + "\n");
  try {
    wrangler("d1", "execute", DB, where, ...persist, "--yes", `--file=${file}`);
  } finally {
    rmSync(file, { force: true });
  }
};

/** 같은 그림인지: 카카오 CDN 주소의 폴더(…/img_scrap.jpg, …/img.jpg 는 같은 그림) */
const imageKey = (url) => String(url || "").replace(/^https?:/, "").replace(/\/[^/]+\.(jpe?g|png|gif|webp)$/i, "");
const S = (v, n = 80) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const list = (v, n = 6) => (Array.isArray(v) ? v.map((x) => S(String(x ?? ""), 60)).filter((x) => x && x !== "-").slice(0, n) : []);

/** 줄 모양을 맞춘다 (AI 가 옮긴 것도 사람이 옮긴 것과 같은 모양) */
function cleanRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r, i) => ({
      no: Number.isFinite(Number(r?.no)) ? Number(r.no) : i + 1,
      name: S(r?.name, 30),
      nicks: list(r?.nicks),
      phones: list(r?.phones).filter((p) => /^\d{3,4}$/.test(p)),
      accounts: list(r?.accounts),
      note: S(r?.note === "-" ? "" : r?.note),
      note2: S(r?.note2 === "-" ? "" : r?.note2),
    }))
    .filter((r) => r.name || r.nicks.length || r.accounts.length || r.phones.length)
    .slice(0, 500);
}

function current() {
  return query("SELECT src, title, made, rows, updated_at FROM scam_list WHERE id = 1")[0] ?? null;
}

function save(d, made, now) {
  const rows = JSON.stringify(cleanRows(d.rows));
  runSql([
    "INSERT INTO scam_list (id, src, title, by, post, rule, rows, made, updated_at, checked_at) VALUES " +
      `(1, ${q(d.image)}, ${q(S(d.title, 60) || "아이모 사기꾼 명단")}, ${q(S(d.by, 30))}, ${q(d.post || POST)}, ${q(S(d.rule, 80))}, ${q(rows)}, ${q(made)}, ${now}, ${now}) ` +
      "ON CONFLICT (id) DO UPDATE SET src = excluded.src, title = excluded.title, by = excluded.by, post = excluded.post, rule = excluded.rule, " +
      "rows = excluded.rows, made = excluded.made, updated_at = excluded.updated_at, checked_at = excluded.checked_at;",
  ]);
}

const now = Date.now();

// ---------- 배포: 사람이 옮긴 것 ----------
if (seedFile) {
  let d;
  try {
    d = JSON.parse(readFileSync(seedFile, "utf8"));
  } catch {
    console.log("사기꾼 명단 파일이 없어서 건너뛰어요");
    process.exit(0);
  }
  const cur = current();
  if (cur && imageKey(cur.src) !== imageKey(d.image)) {
    console.log("DB 의 사기꾼 명단이 더 새 그림이라 그대로 둬요");
    process.exit(0);
  }
  const rows = cleanRows(d.rows);
  if (cur && cur.made === "person" && cur.rows === JSON.stringify(rows) && cur.title === S(d.title, 60)) {
    console.log("사기꾼 명단이 그대로예요");
    process.exit(0);
  }
  save(d, "person", now);
  console.log(`사기꾼 명단 ${rows.length}줄을 넣었어요`);
  process.exit(0);
}

// ---------- 일주일에 한 번: 포스트의 그림이 바뀌었는지 ----------
const meta = (html, prop) => {
  const m = html.match(new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`, "i"));
  return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : "";
};
let html = "";
try {
  const res = await fetch(POST, { headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile", "accept-language": "ko-KR" }, signal: AbortSignal.timeout(20_000) });
  html = res.ok ? await res.text() : "";
} catch {}
const og = meta(html, "og:image");
const ogTitle = meta(html, "og:title");
if (!og) {
  console.log("사기꾼 명단 포스트를 읽지 못했어요 (다음에 다시)");
  process.exit(0);
}
const image = og.replace(/\/[^/]+\.(jpe?g|png)$/i, "/img.jpg");
const cur = current();
if (cur && imageKey(cur.src) === imageKey(image)) {
  runSql([`UPDATE scam_list SET checked_at = ${now} WHERE id = 1;`]);
  console.log("사기꾼 명단 그림이 그대로예요");
  process.exit(0);
}

const key = process.env.ANTHROPIC_API_KEY?.trim();
if (!key) {
  console.log("ANTHROPIC_API_KEY 가 없어서 사기꾼 명단을 옮기지 못했어요");
  process.exit(0);
}
let img = await fetch(image, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
if (!img?.ok) img = await fetch(og, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
if (!img?.ok) {
  console.log("사기꾼 명단 그림을 받지 못했어요 (다음에 다시)");
  process.exit(0);
}
const b64 = Buffer.from(await img.arrayBuffer()).toString("base64");
const type = (img.headers.get("content-type") || "image/jpeg").split(";")[0];

const SYSTEM = `너는 모바일 MMORPG 아이모 거래 톡방에서 돌려 보는 '아이모 사기꾼 명단' 표 그림을 글자 자료로 옮긴다.
이 자료는 길드원이 게임 아이템·골드를 거래하기 전에 상대가 사기 신고된 사람인지 확인하는 데만 쓴다 (사기 피해 막기). 그림에 이미 가려진(x, xx) 글자는 가려진 그대로 옮긴다.
표의 칸: 번호, 이름, 인게임 닉네임, 폰번호 뒤 네자리, 계좌번호, 비고, 비고2.
JSON 하나로만 답한다 (다른 글, 코드 블록 없이): {"title": "그림 맨 위 제목", "rows": [{"no": 번호, "name": "이름 칸 그대로", "nicks": ["닉네임", …], "phones": ["뒤 네자리", …], "accounts": ["은행 이름 계좌번호", …], "note": "비고", "note2": "비고2"}]}
- 번호마다 한 줄. 여러 번호에 걸쳐 합친 칸(이름, 비고)은 그 번호들 모두에 같은 값을 넣는다. 한 번호에 줄이 둘 이상이면(계좌 둘) 한 줄에 모은다.
- '-' 나 빈 칸은 빈 목록이나 빈 글. 쉼표로 이은 닉네임·폰번호·계좌는 나눠서 목록에. 계좌는 '은행 번호' 순서로 (예: '1001736601xx 케이뱅크' -> '케이뱅크 1001736601xx').
- 숫자·글자 하나하나 그림 그대로. 짐작으로 채우지 않는다.`;

const { default: Anthropic } = await import("@anthropic-ai/sdk");
const ws = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
const client = new Anthropic({ apiKey: key, maxRetries: 3, ...(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {}) });
const params = {
  model: MODEL,
  max_tokens: 32000,
  output_config: { effort: "high" },
  system: SYSTEM,
  messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: type, data: b64 } }, { type: "text", text: "이 표를 옮겨 줘." }] }],
};
let res;
try {
  res = await client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }).finalMessage();
} catch (e) {
  if (!(e instanceof Anthropic.BadRequestError)) {
    console.log("사기꾼 명단을 옮기다 실패했어요 (다음에 다시)");
    process.exit(0);
  }
  res = await client.messages.stream(params).finalMessage();
}
const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
let got = null;
try {
  got = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
} catch {}
const rows = cleanRows(got?.rows);
const before = cur ? JSON.parse(cur.rows || "[]").length : 0;
const alert = (msg) =>
  runSql([`INSERT INTO alerts (user_id, kind, text, link, created_at) SELECT id, 'account', ${q(msg)}, '#/scam', ${now} FROM users WHERE role = 'developer';`]);
// 너무 줄었으면(다른 그림으로 바뀜, 잘못 읽음) 넣지 않고 알린다. 다음에 다시 보지 않게 확인한 그림은 적어 둔다
if (!rows.length || rows.length < before * 0.6) {
  alert(`[사기꾼 명단] 포스트 그림이 바뀌었는데 옮긴 줄이 ${rows.length}줄이라(전 ${before}줄) 넣지 않았어요. 그림을 확인해 주세요`);
  if (cur) runSql([`UPDATE scam_list SET src = ${q(image)}, checked_at = ${now} WHERE id = 1;`]);
  console.log(`사기꾼 명단 그림이 바뀌었는데 ${rows.length}줄만 읽혀서 넣지 않았어요`);
  process.exit(0);
}
const title = S(got?.title, 60) || S(ogTitle.match(/아이모 사기꾼 명단/)?.[0], 60) || "아이모 사기꾼 명단";
const by = S(ogTitle.match(/Made by\.?\s*([^)]+)\)/i)?.[1], 30) || "시리온 암";
save({ image, title, by, post: POST, rule: "거래 전 더치트 조회 & 아이템 실물 확인 필수", rows }, "ai", now);
alert(`[사기꾼 명단] 포스트가 바뀌어 새로 옮겼어요 · ${before}줄 → ${rows.length}줄 (AI 가 옮긴 것, 맞는지 확인해 주세요)`);
console.log(`사기꾼 명단을 새로 옮겼어요: ${before}줄 -> ${rows.length}줄`);
