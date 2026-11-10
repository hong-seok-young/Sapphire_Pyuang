// 해외 아이모 팬 위키(imotwom.fandom.com) 문서를 한국어로 옮긴다 (제작자 2026-11-10 '이 사이트 모조리 긁어서 우리 db화 하자 챗봇 답변에 활용해', '해외 사이트는 한글화 잘해봐').
// 긁은 원문은 비공개 자료 저장소 자료/fandom/articles.jsonl (자료/scripts/fetch_fandom.py). 여기서는 문서를 몇 개씩 묶어 Claude 에게 옮기게 한다.
// - 게임 속 이름은 한국 서버 이름으로: 우리 위키 이름 목록(자료/fandom/우리_이름.json)에 같은 것이 있으면 글자 그대로, 없으면 한국 아이모에서 부를 이름으로.
// - Message Batches API (값이 반, 시간 제한 없는 GitHub Actions 에서 기다린다). 가장 좋은 모델, effort high (CLAUDE.md 'AI 는 무조건 품질').
// - 이미 옮긴 문서(자료/fandom/ko.jsonl 의 src 가 같은 것)는 건너뛴다. 못 옮긴 문서는 다음에 다시.
// - 결과: <out>/ko.jsonl (모든 번역, 이전 것 포함), <out>/ko/<묶음>_NN.md (챗봇 자료 저장소 읽기용, 문서마다 '## 한국어 이름 (영문)'), <out>/batch.json, <out>/report.json.
//   GitHub Actions(.github/workflows/fandom-ko.yml)가 out 을 암호화해 올리고, 세션이 받아 자료 저장소 fandom/ 에 넣는다 (자료 저장소 토큰이 읽기 전용이라).
// 공개 저장소 실행 기록에는 개수만 찍는다.
//   node scripts/translate-fandom.mjs [--out out-fandom] [--limit 문서수] [--batch 묶음ID(이어 받기)] [--wait 분]
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "../자료/fandom";
const MODEL = "claude-opus-5-5";
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const OUT = arg("--out", "out-fandom");
const LIMIT = Number(arg("--limit", "0")) || Infinity;
const WAIT_MIN = Number(arg("--wait", "320"));
const RESUME = arg("--batch", "");
/** 한 요청에 넣는 영어 글자 수, 한 문서를 나눌 크기 */
const GROUP_CHARS = 9000;
const GROUP_DOCS = 15;
const PART_CHARS = 14000;

const key = process.env.ANTHROPIC_API_KEY?.trim();
if (!key && !process.argv.includes("--dry")) {
  console.log("ANTHROPIC_API_KEY 가 없어서 건너뛰어요");
  process.exit(0);
}
if (!existsSync(join(ROOT, "articles.jsonl"))) {
  console.log("자료/fandom/articles.jsonl 이 없어요");
  process.exit(1);
}
mkdirSync(join(OUT, "ko"), { recursive: true });

const sha = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const readJsonl = (p) =>
  existsSync(p)
    ? readFileSync(p, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

const articles = readJsonl(join(ROOT, "articles.jsonl"));
const prev = new Map(readJsonl(join(ROOT, "ko.jsonl")).map((r) => [r.title, r]));
const names = existsSync(join(ROOT, "우리_이름.json")) ? JSON.parse(readFileSync(join(ROOT, "우리_이름.json"), "utf8")) : {};

/** 옮기지 않는 것: 위키 운영 글, 팬 소설, 해외 길드 소개, 지울 글 */
const SKIP_TITLE = /^IMO: The World of Magic Wiki:|^Administrators$|Stories$|guildmark/i;
const SKIP_CAT = new Set(["Guilds", "Community", "Candidates for deletion"]);
const skipped = (a) => SKIP_TITLE.test(a.title) || a.categories.some((c) => SKIP_CAT.has(c)) || !a.text.trim();

/** 묶음 (파일 나누기와 옮기는 차례). 쓸모 있는 것부터 */
const BUCKETS = [
  ["가이드", (c) => c.some((x) => /^Guide/.test(x))],
  ["몬스터", (c) => c.some((x) => /Monster|Boss/.test(x))],
  ["퀘스트", (c) => c.some((x) => x === "Quests" || x === "Quest" || /^Quest Monster$/.test(x))],
  ["지역", (c) => c.some((x) => /^(Map|Instant Dungeon|Server)$/.test(x))],
  ["NPC", (c) => c.some((x) => /NPC|Secret Vendors/.test(x))],
  ["스킬", (c) => c.some((x) => /^Skill/.test(x))],
  ["무기", (c) => c.some((x) => /Weapon|Sub-Weapon|Shields|Quivers/.test(x)) && !c.includes("Costume")],
  ["방어구", (c) => c.some((x) => /^(Armor|Hat|Gloves|Shoes|Boots)$|armor|Armor|Hat$/.test(x)) && !c.includes("Costume")],
  ["장신구", (c) => c.some((x) => /^(Rings|Necklace|Belts|Cloaks|Charms)$/.test(x))],
  ["조합·강화", (c) => c.some((x) => /Crafted|Combination|Enchant|Scroll|Repair|Designs/.test(x))],
  ["소모품", (c) => c.some((x) => /^(Supplies|Etc\. Items|Quest Item|Key|Cards|Bags)$/.test(x))],
  ["펫", (c) => c.some((x) => /^(Pet|Egg|Egg Pack|Pet Collection)$/.test(x))],
  ["코스튬", (c) => c.some((x) => /Costume|Hair Styler|Facial Expression/.test(x))],
  ["상자·이벤트", (c) => c.some((x) => /Box|Event|Anniversary/.test(x))],
];
const bucketOf = (a) => BUCKETS.find(([, f]) => f(a.categories))?.[0] ?? "기타";
const order = new Map([...BUCKETS.map(([b]) => b), "기타"].map((b, i) => [b, i]));

const wikiUrl = (t) => "https://imotwom.fandom.com/wiki/" + encodeURIComponent(t.replace(/ /g, "_")).replace(/%2F/g, "/");

// 옮길 문서 (원문이 바뀌지 않은 번역은 그대로 둔다)
const todo = articles
  .filter((a) => !skipped(a))
  .map((a) => ({ ...a, src: sha(a.title + "\n" + a.text), bucket: bucketOf(a) }))
  .filter((a) => prev.get(a.title)?.src !== a.src)
  .sort((a, b) => order.get(a.bucket) - order.get(b.bucket) || a.title.localeCompare(b.title))
  .slice(0, LIMIT);

/** 긴 문서는 문단에서 나눈다 */
function partsOf(text) {
  if (text.length <= PART_CHARS) return [text];
  const out = [];
  let cur = "";
  for (const para of text.split(/\n(?=\n)/)) {
    if (cur && cur.length + para.length > PART_CHARS) {
      out.push(cur);
      cur = "";
    }
    cur += para;
    while (cur.length > PART_CHARS * 1.5) {
      out.push(cur.slice(0, PART_CHARS));
      cur = cur.slice(PART_CHARS);
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// 요청 묶음: { id, items: [{ title, part, parts }] }
const groups = [];
{
  let cur = null;
  const flush = () => {
    if (cur?.items.length) groups.push(cur);
    cur = null;
  };
  for (const a of todo) {
    const parts = partsOf(a.text);
    if (parts.length > 1) {
      flush();
      parts.forEach((p, i) => groups.push({ items: [{ title: a.title, part: i, parts: parts.length, text: p }] }));
      continue;
    }
    if (cur && (cur.chars + a.text.length > GROUP_CHARS || cur.items.length >= GROUP_DOCS)) flush();
    cur ??= { items: [], chars: 0 };
    cur.items.push({ title: a.title, part: 0, parts: 1, text: a.text });
    cur.chars += a.text.length;
  }
  flush();
  groups.forEach((g, i) => (g.id = "g" + String(i).padStart(5, "0")));
}

const nameList = [...(names.items_monsters_equipment ?? []), ...(names.places ?? []), ...(names.regions ?? [])].join(", ");
const SYSTEM = [
  {
    type: "text",
    text: `너는 모바일 게임 아이모(IMO: The World of Magic, 컴투스)의 해외판(글로벌 서버) 팬 위키 imotwom.fandom.com 문서를 한국 아이모 유저가 읽을 한국어로 옮기는 번역가야. 한국 아이모는 같은 게임의 한국 서버다 (영어판 이름은 한국어 이름을 옮긴 것이 많다).

옮기는 법
- 게임 속 이름(아이템, 장비, 몬스터, 보스, NPC, 사냥터·마을·지역, 스킬, 퀘스트, 재료)은 한국 서버에서 부르는 이름으로 써.
  아래 [한국 아이모 위키 이름]에 같은 것이 있으면 그 이름을 글자 그대로(띄어쓰기까지) 써. 없으면 한국 아이모에서 부를 법한 이름으로 옮기고, 문서 안에서 처음 나올 때만 뒤에 (영문 이름)을 붙여.
  예: Death Cloak → 죽음의망토, Woody-Weedy Village → 우디워디 마을, Hunter Bow → 헌터보우. 직업: Warrior 전사, Ranger 레인저, Magician 마법사, Breaker 무도가.
  능력치: STR 힘, DEX 민첩, INT 지능, CON 체력(체질), WIS 지혜(마나), Critical 크리티컬, Accuracy/Hit 명중, Evasion 회피, Armor 아머, Block 막기, HP 체력, MP 마나, Attack Speed 공격 속도, Movement Speed 이동속도.
- 숫자, 확률, 레벨, 시간, 가격, 드랍 목록, 표의 모든 줄과 칸은 하나도 빼거나 줄이지 말고 그대로 옮겨. 요약하지 마. 표는 마크다운 표나 '이름: 값' 줄로.
- 위키 꾸밈(가이드 평가 설문 'How Would You Rate This Guide?' 와 그 선택지, 'Guide Rating:', 편집 안내, 빈 틀)은 빼.
- '(그림: …)' 표시는 '(그림: 한국어 설명)'으로 둬.
- 말투는 짧은 설명체 ('~한다', '~이다'). 글로벌 서버 이야기(해외 이벤트, 해외 길드, 영어 채팅)는 그대로 옮기되 '해외 서버'라고 밝혀.

답 형식 (정확히 이대로, 문서마다 하나씩, 받은 차례대로. 다른 말은 쓰지 마)
=== <받은 원문 제목 글자 그대로>
이름: <한국어 이름>
찾는 말: <쉼표로: 한국어 이름, 띄어쓰기 없는 꼴, 한국 유저가 쓸 줄임말, 영문 이름>
분류: <한국어 분류 1~4개, 쉼표로>
---
<본문 번역>

[한국 아이모 위키 이름]
${nameList}`,
    cache_control: { type: "ephemeral" },
  },
];

function userText(g) {
  return (
    g.items
      .map(
        (it) =>
          `### 원문 제목: ${it.title}\n` +
          (it.parts > 1 ? `(긴 문서라 ${it.parts}부분으로 나눴다. 이번이 ${it.part + 1}번째 부분: 이 부분만 옮겨)\n` : "") +
          `분류(영문): ${articles.find((a) => a.title === it.title)?.categories.join(", ") || "-"}\n\n${it.text}`,
      )
      .join("\n\n────────\n\n") + "\n\n위 문서를 형식대로 옮겨 줘."
  );
}

if (process.argv.includes("--dry")) {
  const per = {};
  for (const a of todo) per[a.bucket] = (per[a.bucket] ?? 0) + 1;
  const chars = todo.reduce((t, a) => t + a.text.length, 0);
  console.log(JSON.stringify({ docs: todo.length, requests: groups.length, chars, systemChars: SYSTEM[0].text.length, buckets: per, longest: Math.max(...groups.map((g) => g.items.reduce((t, i) => t + i.text.length, 0))) }));
  process.exit(0);
}
const ws = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
const client = new Anthropic({ apiKey: key, maxRetries: 4, ...(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {}) });

// 묶음 만들기 (또는 이어 받기)
let batchId = RESUME;
let groupInfo;
const groupMap = () => Object.fromEntries(groups.map((g) => [g.id, g.items.map(({ title, part, parts }) => ({ title, part, parts }))]));
if (batchId) {
  // 이어 받기: 지난번 batch.json 이 없으면 같은 자료로 같은 묶음을 다시 만든다 (자료 저장소가 그대로일 때)
  groupInfo = existsSync(join(OUT, "batch.json")) ? JSON.parse(readFileSync(join(OUT, "batch.json"), "utf8")).groups : groupMap();
} else {
  if (!groups.length) {
    console.log("옮길 문서가 없어요 (모두 옮김)");
    writeOutputs(new Map());
    process.exit(0);
  }
  const requests = groups.map((g) => ({
    custom_id: g.id,
    params: {
      model: MODEL,
      max_tokens: 64000,
      output_config: { effort: "high" },
      system: SYSTEM,
      messages: [{ role: "user", content: userText(g) }],
    },
  }));
  const batch = await client.messages.batches.create({ requests });
  batchId = batch.id;
  groupInfo = groupMap();
  writeFileSync(join(OUT, "batch.json"), JSON.stringify({ id: batchId, created: new Date().toISOString(), groups: groupInfo }));
  console.log(`문서 ${todo.length}개를 요청 ${groups.length}개로 보냈어요`);
}

// 기다리기
const deadline = Date.now() + WAIT_MIN * 60_000;
let batch;
for (;;) {
  batch = await client.messages.batches.retrieve(batchId);
  if (batch.processing_status === "ended") break;
  if (Date.now() > deadline) {
    console.log(`아직 처리 중이라 멈춰요 (끝난 요청 ${batch.request_counts.succeeded + batch.request_counts.errored}개). --batch 로 이어 받아요`);
    writeFileSync(join(OUT, "report.json"), JSON.stringify({ batch: batchId, pending: true, counts: batch.request_counts }));
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 60_000));
}

// 결과 읽기
/** 답 글 -> [{ title, ko, keys, cats, body }] */
function parseAnswer(text) {
  const out = [];
  for (const block of text.split(/^=== /m).slice(1)) {
    const nl = block.indexOf("\n");
    const title = block.slice(0, nl).trim();
    const rest = block.slice(nl + 1);
    const cut = rest.search(/^---\s*$/m);
    if (cut < 0) continue;
    const head = rest.slice(0, cut);
    const body = rest.slice(cut).replace(/^---\s*\n?/, "").trim();
    const field = (k) => head.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
    out.push({ title, ko: field("이름"), keys: field("찾는 말"), cats: field("분류"), body });
  }
  return out;
}

const done = new Map(); // title -> { parts: [], head }
let failedReq = 0;
let usage = { in: 0, out: 0, cacheRead: 0 };
for await (const r of await client.messages.batches.results(batchId)) {
  const items = groupInfo[r.custom_id] ?? [];
  if (r.result.type !== "succeeded") {
    failedReq++;
    continue;
  }
  const msg = r.result.message;
  usage.in += msg.usage.input_tokens ?? 0;
  usage.out += msg.usage.output_tokens ?? 0;
  usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0;
  if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") {
    failedReq++;
    continue;
  }
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const got = parseAnswer(text);
  for (const it of items) {
    const hit = got.find((x) => x.title === it.title) ?? (items.length === 1 ? got[0] : undefined);
    if (!hit || !hit.body) continue;
    const e = done.get(it.title) ?? { parts: new Array(it.parts).fill(null), head: null };
    e.parts[it.part] = hit.body;
    if (it.part === 0 || !e.head) e.head = hit;
    done.set(it.title, e);
  }
}

const fresh = new Map();
for (const [title, e] of done) {
  if (e.parts.some((p) => p === null)) continue; // 나눈 문서 중 한 부분이라도 못 옮기면 다음에
  const a = articles.find((x) => x.title === title);
  if (!a) continue;
  fresh.set(title, {
    title,
    src: sha(a.title + "\n" + a.text),
    ko: e.head.ko || title,
    keys: e.head.keys,
    cats: e.head.cats,
    bucket: bucketOf(a),
    url: wikiUrl(title),
    timestamp: a.timestamp,
    body: e.parts.join("\n\n"),
    model: MODEL,
    at: new Date().toISOString().slice(0, 10),
  });
}
writeOutputs(fresh);
const report = { batch: batchId, requests: Object.keys(groupInfo).length, failedRequests: failedReq, translated: fresh.size, usage };
writeFileSync(join(OUT, "report.json"), JSON.stringify(report));
console.log(`옮긴 문서 ${fresh.size}개, 실패한 요청 ${failedReq}개, 토큰 입력 ${usage.in} · 캐시 ${usage.cacheRead} · 출력 ${usage.out}`);

/** ko.jsonl (이전 번역 + 새 번역)과 묶음별 md */
function writeOutputs(fresh) {
  const all = new Map(prev);
  for (const [t, r] of fresh) all.set(t, r);
  // 원문에서 없어진 문서는 뺀다
  const titles = new Set(articles.map((a) => a.title));
  const rows = [...all.values()].filter((r) => titles.has(r.title)).sort((a, b) => order.get(a.bucket) - order.get(b.bucket) || a.ko.localeCompare(b.ko, "ko"));
  writeFileSync(join(OUT, "ko.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  const byBucket = new Map();
  for (const r of rows) (byBucket.get(r.bucket) ?? byBucket.set(r.bucket, []).get(r.bucket)).push(r);
  for (const [bucket, list] of byBucket) {
    for (let i = 0; i < list.length; i += 100) {
      const n = String(i / 100 + 1).padStart(2, "0");
      const md =
        `# 해외 아이모 위키 한국어 번역 · ${bucket} ${n}\n` +
        "해외판(글로벌 서버) 팬 위키 imotwom.fandom.com (CC BY-SA) 문서를 한국어로 옮긴 것. 2010년대 글이 많고 한국 서버와 이름·수치·이벤트가 다를 수 있다.\n\n" +
        list
          .slice(i, i + 100)
          .map(
            (r) =>
              `## ${r.ko} (${r.title})\n` +
              `원문: ${r.url}${r.timestamp ? ` (원문 고친 날 ${String(r.timestamp).slice(0, 10)})` : ""} · 분류: ${r.cats || r.bucket}${r.keys ? ` · 찾는 말: ${r.keys}` : ""}\n\n` +
              r.body,
          )
          .join("\n\n");
      writeFileSync(join(OUT, "ko", `${bucket.replace(/[\\/:*?"<>|·]/g, "_")}_${n}.md`), md + "\n");
    }
  }
}
