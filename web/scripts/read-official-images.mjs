// 공식 글 속 그림을 글자로 옮긴다 (제작자 요청 2026-11-06: '이벤트에 있는 모든 데이터 이미지 포함해서 싹 다 데이터화'). server/officialImages.ts 설명 참고.
// 1. 사람이 직접 확인한 그림 글(--manual, 비공개 자료 공식/그림글.json: { 그림 주소: 글 })을 먼저 넣는다 (배포가 한다).
// 2. 새로 들어왔거나 바뀐 공식 글마다 본문 글자 속 그림 자리에 ⟦그림 N⟧ 을 넣어 official_rich 에 둔다. 원문은 withhive 에서 다시 받고
//    (본문 안에 통째로 든 그림(data:)까지), 한국 밖에서 안 보이는 글은 D1 의 간단한 HTML 로.
// 3. 아직 안 옮긴 그림을 새 글 것부터 Claude 가 옮긴다 (그림 주소마다 한 번). 큰 표는 세로로 잘라 글자가 뭉개지지 않게 보낸다.
// GitHub Actions 가 돌린다 (.github/workflows/official-news.yml 30분마다, deploy-web.yml 배포 끝에). 시간 제한이 없어 가장 좋은 모델을 높은 effort 로 쓴다
// (제작자 요청: AI 는 비용보다 품질). 비밀값 ANTHROPIC_API_KEY 가 없으면 3은 건너뛴다. 공개 저장소라 실행 기록에는 개수만 찍는다.
//   node --experimental-strip-types scripts/read-official-images.mjs --budget 1200
//   node --experimental-strip-types scripts/read-official-images.mjs --manual ../자료/공식/그림글.json --budget 240
//   node --experimental-strip-types scripts/read-official-images.mjs --local [--persist-to <폴더>]   로컬 D1 에 (시험용)
import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bytes, fitBytes, htmlToText } from "../server/officialText.ts";
import { RICH_V, imgToken } from "../server/officialImages.ts";

const DB = "sapphire-accounts";
const GAME = 32;
const MODEL = "claude-opus-5-5";
/** 옮긴 모델과 지시문의 판 (official_img.model). 지시문을 고쳐도 이미 옮긴 그림은 그대로 둔다 (다시 하려면 그 줄을 지운다) */
const TAG = `${MODEL}#1`;
const local = process.argv.includes("--local");
const where = local ? "--local" : "--remote";
const persistAt = process.argv.indexOf("--persist-to");
const PERSIST = local && persistAt >= 0 ? ["--persist-to", process.argv[persistAt + 1]] : [];
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const budgetMs = Number(arg("--budget") ?? 0) * 1000;
const manualFile = arg("--manual");
const started = Date.now();
/** 한 번에 같이 맡기는 그림 수 */
const PARALLEL = 6;

const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const wrangler = (...args) =>
  execFileSync(process.execPath, [WRANGLER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 256 * 1024 * 1024 });
const parseJson = (text) => JSON.parse(text.slice(text.search(/[[{]/)));
const select = (sql) => parseJson(wrangler("d1", "execute", DB, where, ...PERSIST, "--json", "--command", sql))[0]?.results ?? [];
const q = (s) => (s === null || s === undefined ? "NULL" : typeof s === "number" ? String(s) : "'" + String(s).replace(/\u0000/g, "").replace(/'/g, "''") + "'");
function runFile(sql) {
  if (!sql.trim()) return;
  writeFileSync("official-images.sql", sql);
  try {
    wrangler("d1", "execute", DB, where, ...PERSIST, "--yes", "--file=official-images.sql");
  } finally {
    rmSync("official-images.sql", { force: true });
  }
}
/** SQL 줄 여럿을 파일 하나가 너무 커지지 않게 나눠서 */
function runMany(lines) {
  let buf = "";
  for (const l of lines) {
    if (buf && bytes(buf) + bytes(l) > 900_000) {
      runFile(buf);
      buf = "";
    }
    buf += l + "\n";
  }
  runFile(buf);
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

function ensureDbId() {
  if (local) return;
  const toml = readFileSync("wrangler.toml", "utf8");
  if (!/^database_id = "0{8}-/m.test(toml)) return;
  const id = parseJson(wrangler("d1", "list", "--json")).find((d) => d.name === DB)?.uuid;
  if (!id) throw new Error("계정 DB를 찾지 못했어요: " + DB);
  writeFileSync("wrangler.toml", toml.replace(/^database_id = ".*"$/m, `database_id = "${id}"`));
}

ensureDbId();
runFile(`CREATE TABLE IF NOT EXISTS official_img (key TEXT PRIMARY KEY, text TEXT NOT NULL, made_at INTEGER NOT NULL, model TEXT);
CREATE TABLE IF NOT EXISTS official_rich (id INTEGER PRIMARY KEY, src TEXT, v TEXT, text TEXT, keys TEXT NOT NULL DEFAULT '[]', made_at INTEGER NOT NULL);
`);

// 1. 사람이 확인한 그림 글
if (manualFile && existsSync(manualFile)) {
  const manual = JSON.parse(readFileSync(manualFile, "utf8"));
  const now = Date.now();
  const lines = Object.entries(manual)
    .filter(([url, text]) => /^https?:\/\//.test(url) && typeof text === "string")
    .map(
      ([url, text]) =>
        `INSERT INTO official_img (key, text, made_at, model) VALUES (${q(new URL(url).href)}, ${q(fitBytes(text.trim(), 95_000))}, ${now}, 'manual') ` +
        "ON CONFLICT (key) DO UPDATE SET text = excluded.text, made_at = excluded.made_at, model = 'manual' WHERE official_img.model IS NOT 'manual' OR official_img.text IS NOT excluded.text;",
    );
  runMany(lines);
  console.log(`사람이 확인한 그림 글 ${lines.length}개`);
}

// 2. 글마다 그림 자리
const pending = select(
  `SELECT n.id, n.kind, n.title, n.src FROM official_news n LEFT JOIN official_rich r ON r.id = n.id WHERE r.id IS NULL OR r.src IS NOT n.src OR r.v IS NOT '${RICH_V}' ORDER BY n.id DESC`,
);
console.log(`그림 자리를 만들 공식 글 ${pending.length}개`);

async function fetchPage(type, page, rows) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`https://withhive.com/api/notice/list/${GAME}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", accept: "application/json", cookie: "language=ko" },
        body: `page=${page}&type=${type}&rows=${rows}`,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()).data;
      return Array.isArray(data?.notice_list) ? data.notice_list : [];
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(3000 * attempt);
    }
  }
}

/** withhive 원문 (그림 자료 data: 까지 든 것). 맡을 글의 가장 작은 번호까지만 받는다 */
async function rawContents(posts) {
  const out = new Map();
  for (const [type, kind] of [["", "notice"], ["E", "event"]]) {
    const want = new Set(posts.filter((p) => p.kind === kind).map((p) => p.id));
    if (!want.size) continue;
    const min = Math.min(...want);
    for (let page = 1; page <= 40; page++) {
      let list;
      try {
        list = await fetchPage(type, page, 30);
      } catch {
        break; // 못 받은 글은 D1 의 간단한 HTML 로
      }
      for (const item of list) {
        const id = Number(item?.noticeId);
        if (want.has(id) && item.content) out.set(id, String(item.content));
      }
      if (list.length < 30 || list.some((i) => Number(i?.noticeId) <= min)) break;
      await sleep(800);
    }
  }
  return out;
}

const attrOf = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? m[2] ?? m[3] ?? m[4] : null;
};
/** 그림 주소 -> 표의 key (data: 그림은 내용의 해시). 쓸 수 없는 주소면 null */
function keyOf(raw) {
  const s = String(raw ?? "").trim().replace(/&amp;/g, "&");
  if (s.startsWith("data:image/")) return "data:" + createHash("sha256").update(s).digest("hex").slice(0, 32);
  try {
    const u = new URL(s.startsWith("//") ? "https:" + s : s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** 원문 HTML -> 그림 자리를 넣은 본문 글자와 그림 key 목록 (+ 이번에만 가진 data: 그림) */
function richOf(html, dataOut) {
  const keys = [];
  const tokenized = String(html).replace(/<img\b[^>]*>/gi, (tag) => {
    const src = attrOf(tag, "src");
    const key = keyOf(src);
    if (!key) return " ";
    if (key.startsWith("data:")) dataOut.set(key, String(src).trim());
    let i = keys.indexOf(key);
    if (i < 0) i = keys.push(key) - 1;
    return `<p>${imgToken(i)}</p>`;
  });
  return { text: fitBytes(htmlToText(tokenized), 90_000), keys };
}

/** 이번에 가진 data: 그림 (key -> data URI) */
const dataImages = new Map();
/** 그림마다 처음 나온 글 (제목과 그림 앞 글을 옮기기 도움말로) */
const contextOf = new Map();
if (pending.length) {
  const raw = await rawContents(pending);
  const lines = [];
  const now = Date.now();
  for (let i = 0; i < pending.length; i += 40) {
    const chunk = pending.slice(i, i + 40);
    const need = chunk.filter((p) => !raw.has(p.id)).map((p) => p.id);
    const html = new Map(need.length ? select(`SELECT id, html FROM official_news WHERE id IN (${need.join(", ")})`).map((r) => [r.id, r.html]) : []);
    for (const p of chunk) {
      const content = raw.get(p.id) ?? html.get(p.id);
      if (!content) {
        lines.push(
          `INSERT INTO official_rich (id, src, v, text, keys, made_at) VALUES (${p.id}, ${q(p.src)}, '${RICH_V}', NULL, '[]', ${now}) ` +
            "ON CONFLICT (id) DO UPDATE SET src = excluded.src, v = excluded.v, text = excluded.text, keys = excluded.keys, made_at = excluded.made_at;",
        );
        continue;
      }
      const { text, keys } = richOf(content, dataImages);
      keys.forEach((k, n) => {
        if (contextOf.has(k)) return;
        const at = text.indexOf(imgToken(n));
        contextOf.set(k, { title: p.title, before: text.slice(Math.max(0, at - 300), Math.max(0, at)).replace(/⟦그림 \d+⟧/g, "").trim() });
      });
      lines.push(
        `INSERT INTO official_rich (id, src, v, text, keys, made_at) VALUES (${p.id}, ${q(p.src)}, '${RICH_V}', ${q(text)}, ${q(JSON.stringify(keys))}, ${now}) ` +
          "ON CONFLICT (id) DO UPDATE SET src = excluded.src, v = excluded.v, text = excluded.text, keys = excluded.keys, made_at = excluded.made_at;",
      );
    }
  }
  runMany(lines);
  console.log(`그림 자리를 만든 글 ${lines.length}개 (원문 ${raw.size}개, 나머지는 저장해 둔 HTML)`);
}

// 3. 아직 안 옮긴 그림 (새 글 것부터)
const missing = select(
  "SELECT k.value AS key, MAX(r.id) AS post FROM official_rich r, json_each(r.keys) k LEFT JOIN official_img g ON g.key = k.value WHERE g.key IS NULL GROUP BY k.value ORDER BY post DESC",
);
const key = process.env.ANTHROPIC_API_KEY?.trim();
const todo = missing.filter((m) => !m.key.startsWith("data:") || dataImages.has(m.key));
console.log(`옮길 그림 ${todo.length}개 (본문 속 그림 자료라 이번에 못 하는 것 ${missing.length - todo.length}개)`);
if (!key) {
  console.log("ANTHROPIC_API_KEY 가 없어서 그림 옮기기를 건너뛰어요");
  process.exit(0);
}
// 지난번에 못 옮긴 그림은 그 글의 제목을 도움말로
{
  const ids = [...new Set(todo.filter((m) => !contextOf.has(m.key)).map((m) => m.post))];
  for (let i = 0; i < ids.length; i += 200) {
    const titles = new Map(select(`SELECT id, title FROM official_news WHERE id IN (${ids.slice(i, i + 200).join(", ")})`).map((r) => [r.id, r.title]));
    for (const m of todo) if (!contextOf.has(m.key) && titles.has(m.post)) contextOf.set(m.key, { title: titles.get(m.post), before: "" });
  }
}
const ws = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
const client = new Anthropic({ apiKey: key, maxRetries: 3, ...(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {}) });

let sharp = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.log("그림 자르기 도구(sharp)가 없어서 그림을 그대로 보내요");
}

/** 그림 받기: 바이트, 없어진 그림이면 "gone", 잠깐 안 되면 null */
async function download(k) {
  if (k.startsWith("data:")) {
    const uri = dataImages.get(k);
    const m = /^data:[^;,]+(;base64)?,(.*)$/s.exec(uri ?? "");
    if (!m) return "gone";
    return m[1] ? Buffer.from(m[2], "base64") : Buffer.from(decodeURIComponent(m[2]));
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(k, { signal: AbortSignal.timeout(30_000), headers: { "user-agent": "Mozilla/5.0 (sapphire guild wiki)" } });
      if ([403, 404, 410].includes(res.status)) return "gone";
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch {
      await sleep(2000 * attempt);
    }
  }
  return null;
}

const typeOf = (b) =>
  b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b.slice(0, 3).toString() === "GIF" ? "image/gif" : b.slice(8, 12).toString() === "WEBP" ? "image/webp" : null;

/** 한 장에 보내는 크기: 긴 변 1568px, 넓이 115만 화소 안 (넘으면 API 가 줄여서 작은 글자가 뭉개진다) */
const EDGE = 1568;
const AREA = 1_150_000;
const OVERLAP = 48;

/** 그림 -> 보낼 조각들 [{ type, b64 }] (작은 아이콘이면 "small") */
async function tilesOf(buf) {
  if (!sharp) {
    const type = typeOf(buf);
    return type && buf.length < 3_700_000 ? [{ type, b64: buf.toString("base64") }] : [];
  }
  const { data, info } = await sharp(buf, { pages: 1, limitInputPixels: false }).flatten({ background: "#ffffff" }).png().toBuffer({ resolveWithObject: true });
  const w0 = info.width;
  const h0 = info.height;
  if (Math.max(w0, h0) < 100 || w0 * h0 < 15_000) return "small";
  const W = Math.min(w0, EDGE);
  const scaled = W === w0 ? data : await sharp(data).resize({ width: W }).png().toBuffer();
  const H = Math.round((h0 * W) / w0);
  const tileH = Math.min(EDGE, Math.floor(AREA / W));
  const enc = async (img) => {
    const png = await sharp(img).png().toBuffer();
    if (png.length < 3_500_000) return { type: "image/png", b64: png.toString("base64") };
    return { type: "image/jpeg", b64: (await sharp(img).jpeg({ quality: 90 }).toBuffer()).toString("base64") };
  };
  if (H <= tileH * 1.05) return [await enc(scaled)];
  const out = [];
  const step = tileH - OVERLAP;
  for (let top = 0; top < H - OVERLAP; top += step) {
    const height = Math.min(tileH, H - top);
    out.push(await enc(await sharp(scaled).extract({ left: 0, top, width: W, height }).png().toBuffer()));
  }
  return out;
}

const SYSTEM = `너는 모바일 MMORPG 아이모(IMO: The World of Magic, 컴투스)의 공식 공지·이벤트 글에 들어 있는 그림을 글자로 옮긴다.
옮긴 글은 길드 앱 챗봇이 그림 대신 읽고 길드원의 질문(교환 목록, 확률, 보상, 기간, 재료, NPC 위치)에 답하는 데 쓴다. 그림에 있는 정보가 하나라도 빠지면 챗봇이 틀린 답을 한다.

옮기는 법
- 그림 속 글자, 숫자, 표를 빠짐없이 보이는 그대로 옮긴다. 요약하거나 고치거나 빼지 않는다. 아이템 이름(띄어쓰기까지), 개수(x5), 확률(%), 좌표, 날짜·시각, 로마 숫자(I, II, III, IV, V)는 그대로.
- 표는 마크다운 표로 옮긴다. 여러 줄에 걸쳐 합쳐진 칸(왼쪽의 NPC 칸, 묶인 재료 칸)은 표 위에 '- NPC: 이름 (위치 좌표)'처럼 한 줄로 적거나, 그 칸이 걸친 줄마다 같은 값을 되풀이해서 어느 줄에 해당하는지 알 수 있게 한다. 빈 칸은 비워 둔다.
- 표가 여러 개면 표마다 무엇의 표인지 알 수 있게 표 위에 그림 속 제목이나 머리글을 그대로 한 줄 적는다 (예: '직업이 전사일 경우 선택지').
- 빨간 글씨처럼 색으로 강조한 글자는 뒤에 '(빨간 글씨)'를 붙인다. 취소선은 '~~글자~~'.
- 아이템 아이콘, 캐릭터, 장식처럼 글자가 아닌 그림은 표 칸에 이름이 같이 적혀 있으면 이름만 옮긴다. 이름 없이 그림만 있으면 짧게 '(○○ 그림)'.
- 글자가 하나도 없고 뜻 있는 정보도 없는 그림(무늬, 장식, 사진 배경)이면 NO_TEXT 한 단어만 쓴다.
- 여러 장으로 나눠 보낸 그림은 한 그림을 위에서 아래로 차례로 자른 것이다 (자른 곳이 조금씩 겹친다). 한 그림처럼 이어서 옮기고 겹친 줄은 한 번만 적는다.
- 앞뒤 인사, 설명, 코드 블록 없이 옮긴 글만 쓴다.`;

/** 그림 하나를 옮긴다: { text, model } (거절당하면 NO_TEXT) */
async function transcribe(tiles, ctx) {
  const parts = [];
  for (let i = 0; i < tiles.length; i += 20) {
    const chunk = tiles.slice(i, i + 20);
    const note =
      `공식 글 제목: ${ctx?.title ?? "(모름)"}\n` +
      (ctx?.before ? `글에서 이 그림 바로 앞의 글: ${ctx.before}\n` : "") +
      (tiles.length > 1 ? `이 그림은 위에서 아래로 ${tiles.length}장으로 잘라 보냈다. 이번에 ${i + 1}~${i + chunk.length}번째 장.${i ? " 앞 장들은 이미 옮겼으니 이어서만 옮긴다." : ""}\n` : "") +
      "위 그림을 옮겨 줘.";
    const messages = [
      { role: "user", content: [...chunk.map((t) => ({ type: "image", source: { type: "base64", media_type: t.type, data: t.b64 } })), { type: "text", text: note }] },
    ];
    const params = { model: MODEL, max_tokens: 64000, output_config: { effort: "high" }, system: SYSTEM, messages };
    let res;
    try {
      res = await client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }).finalMessage();
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      res = await client.messages.stream(params).finalMessage();
    }
    if (res.stop_reason === "refusal") return { text: "", model: "refused" };
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (text && text !== "NO_TEXT") parts.push(text.replace(/^```\w*\n?|\n?```$/g, "").trim());
  }
  return { text: parts.join("\n"), model: TAG };
}

const results = [];
let done = 0;
let empty = 0;
let failed = 0;
let next = 0;
const flush = () => {
  const rows = results.splice(0);
  runMany(
    rows.map(
      (r) =>
        `INSERT INTO official_img (key, text, made_at, model) VALUES (${q(r.key)}, ${q(fitBytes(r.text, 95_000))}, ${Date.now()}, ${q(r.model)}) ` +
        "ON CONFLICT (key) DO UPDATE SET text = excluded.text, made_at = excluded.made_at, model = excluded.model WHERE official_img.model IS NOT 'manual';",
    ),
  );
};
async function worker() {
  for (;;) {
    if (budgetMs && Date.now() - started > budgetMs) return;
    const item = todo[next++];
    if (!item) return;
    try {
      const buf = await download(item.key);
      if (!buf) {
        failed++;
        continue;
      }
      if (buf === "gone") {
        results.push({ key: item.key, text: "", model: "gone" });
        empty++;
        continue;
      }
      const tiles = await tilesOf(buf);
      if (tiles === "small" || !tiles.length) {
        results.push({ key: item.key, text: "", model: tiles === "small" ? "small" : "unreadable" });
        empty++;
        continue;
      }
      const r = await transcribe(tiles, contextOf.get(item.key));
      results.push({ key: item.key, ...r });
      if (r.text) done++;
      else empty++;
    } catch (e) {
      failed++;
      console.log(`그림 하나를 옮기지 못했어요 (${e?.status ?? ""} ${String(e?.message ?? e).slice(0, 120)})`);
    }
    if (results.length >= 12) flush();
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker));
flush();
console.log(`그림 옮김 ${done}개, 글자 없는 그림 ${empty}개, 실패 ${failed}개, 남은 것 ${Math.max(0, todo.length - next)}개`);

// 본문 속 그림 자료(data:)를 다 옮기지 못한 글은 다음에 원문을 다시 받아 이어서 한다
const partial = select(
  `SELECT DISTINCT r.id FROM official_rich r, json_each(r.keys) k LEFT JOIN official_img g ON g.key = k.value WHERE g.key IS NULL AND k.value LIKE 'data:%'`,
).map((r) => r.id);
if (partial.length) runFile(`UPDATE official_rich SET v = '${RICH_V}p' WHERE id IN (${partial.join(", ")});\n`);
