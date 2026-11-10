// 해외 아이모 팬 위키 그림 가려내기와 글자로 옮기기 (제작자 2026-11-10 '퀄리티 떨어지지 않을 정도로만 압축하거나 쓸만한 거만 추리거나 텍스트화할 수 있는 애들은 텍스트화',
// '모든 이미지가 다 유용한 건 아닌 거 같아서, 우리 DB 에 있는 거면 더더욱 중복').
// 자료/fandom/images.json 의 그림 중 아이콘(긴 변 128px 이하)과 유저 커뮤니티·팬아트·길드마크 글에만 쓰인 그림을 뺀 나머지를 Claude 가 한 장씩 보고
//   쓸모(아이템 정보창·스탯 창, 드랍·확률 표, 지도, 퀘스트·NPC 대화, 공략 설명 그림) / 쓸모없음(인증샷·팬아트·홍보·꾸밈)을 가르고, 쓸모 있으면 그림 속 글자·숫자를 한국어로 옮긴다.
// 그림은 위키 CDN 주소를 그대로 넘긴다 (Batch 요청 크기 한도 때문에 base64 로 싣지 않는다). Message Batches API, 가장 좋은 모델 effort high.
// 결과: <out>/그림글.json ({ 파일: { useful, kind, desc, text, articles, model, at } }, 이전 결과 포함). 세션이 받아 쓸모 있는 그림만 압축해 남기고 글은 챗봇 자료로.
//   node scripts/fandom-images.mjs [--out out-fandom-img] [--limit N] [--batch ID] [--wait 분] [--dry]
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "../자료/fandom";
const MODEL = "claude-opus-5-5";
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const OUT = arg("--out", "out-fandom-img");
const LIMIT = Number(arg("--limit", "0")) || Infinity;
const WAIT_MIN = Number(arg("--wait", "320"));
const RESUME = arg("--batch", "");
const DRY = process.argv.includes("--dry");

const key = process.env.ANTHROPIC_API_KEY?.trim();
if (!key && !DRY) {
  console.log("ANTHROPIC_API_KEY 가 없어서 건너뛰어요");
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });

const readJsonl = (p) =>
  existsSync(p)
    ? readFileSync(p, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const images = JSON.parse(readFileSync(join(ROOT, "images.json"), "utf8"));
const articles = new Map(readJsonl(join(ROOT, "articles.jsonl")).map((a) => [a.title, a]));
const ko = new Map(readJsonl(join(ROOT, "ko.jsonl")).map((r) => [r.title, r]));
const names = existsSync(join(ROOT, "우리_이름.json")) ? JSON.parse(readFileSync(join(ROOT, "우리_이름.json"), "utf8")) : {};
const prevPath = join(ROOT, "그림글.json");
const prev = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : {};

/** 유저 커뮤니티·팬아트·길드마크 글에만 쓰인 그림은 보지 않는다 (게임 정보가 아니다) */
const JUNK_CAT = new Set(["Community", "Art", "Blog posts", "Designs", "Guilds", "Candidates for deletion"]);
const JUNK_TITLE = /Guildmark|Fan ?Pic|Fan ?Art|Stories|User blog/i;
export function isJunk(img) {
  const titles = img.usedBy ?? [];
  if (titles.length && titles.every((t) => JUNK_TITLE.test(t))) return true;
  const cats = new Set(titles.flatMap((t) => articles.get(t)?.categories ?? []));
  return cats.size > 0 && [...cats].some((c) => JUNK_CAT.has(c)) && [...cats].every((c) => JUNK_CAT.has(c) || c === "Event" || c === "Misc");
}
const dim = (x) => Math.max(x.width ?? 0, x.height ?? 0);
const PICTURE = /\.(png|jpe?g|gif|webp)$/i;

const todo = images
  .filter((x) => !x.missing && x.url && PICTURE.test(x.file) && !isJunk(x) && (dim(x) > 128 || (!dim(x) && (x.size ?? 0) > 60_000)))
  .filter((x) => !prev[x.file] || prev[x.file].failed)
  .slice(0, LIMIT);

/** 위키 CDN 주소: 너무 넓으면 1568px 로 줄여 받게 (모델이 어차피 줄여 본다) */
function imageUrl(x) {
  // images.json 의 주소는 이미 '…/revision/latest?cb=…' 꼴이다
  const u = x.url.split("?")[0].replace(/\/revision\/latest.*$/, "") + "/revision/latest";
  return (x.width ?? 0) > 1568 ? `${u}/scale-to-width-down/1568` : u;
}

const nameList = [...(names.items_monsters_equipment ?? []), ...(names.places ?? []), ...(names.regions ?? [])].join(", ");
const SYSTEM = [
  {
    type: "text",
    text: `너는 모바일 게임 아이모(IMO: The World of Magic, 컴투스)의 해외판(글로벌 서버) 팬 위키 imotwom.fandom.com 에 올라온 그림을 한 장씩 보고, 한국 아이모 길드의 자료로 남길지 가르고 그림 속 정보를 한국어 글로 옮기는 사람이야.

쓸모 있음: 게임 정보가 보이는 그림. 아이템·장비 정보창(옵션, 스탯, 요구 레벨), 캐릭터 스탯 창, 드랍·확률·보상·교환 표, 지도와 사냥터 위치, 몬스터·보스 정보, 퀘스트·NPC 대화, 스킬 설명, 공략 설명 그림, 강화·조합 결과 창.
쓸모없음: 게임 정보가 없거나 글로 남길 게 없는 그림. 보스 잡은 인증샷·단체 사진, 팬아트, 홍보 그림(정보 없이 그림만), 꾸밈 그림, 길드마크, 채팅·잡담 스샷, 흐려서 못 읽는 그림, 아이템 그림만 크게 있는 것(정보창 없이).

쓸모 있으면 그림 속 글자·숫자를 빠짐없이 한국어로 옮겨. 게임 속 이름은 한국 서버 이름으로 (아래 [한국 아이모 위키 이름]에 있으면 글자 그대로, 없으면 한국 서버에서 부를 이름, 처음에만 (영문)). 표는 마크다운 표. 지도는 무엇이 어디 있는지 글로. 숫자는 그대로.
직업: Warrior 전사, Ranger 레인저, Magician 마법사, Breaker 무도가. STR 힘, DEX 민첩, INT 지능, CON 체력, WIS 지혜, Critical 크리티컬, Hit 명중.

답 형식 (정확히, 다른 말 없이)
쓸모: 예 또는 아니오
종류: <아이템 정보창 | 스탯 창 | 드랍·확률 표 | 지도 | 몬스터 정보 | 퀘스트·대화 | 스킬 | 공략 설명 | 강화·조합 | 인증샷 | 팬아트 | 홍보 | 꾸밈 | 길드마크 | 채팅 | 기타>
설명: <무엇이 보이는지 한국어 한 줄>
---
<쓸모 있으면 그림 속 정보 글, 아니면 비움>

[한국 아이모 위키 이름]
${nameList}`,
    cache_control: { type: "ephemeral" },
  },
];

const items = todo.map((x, i) => ({ id: "i" + String(i).padStart(5, "0"), file: x.file }));
const byId = new Map(items.map((it) => [it.id, it.file]));
const byFile = new Map(todo.map((x) => [x.file, x]));

/** 지난번에 주소로 못 연 그림은 여기서 받아 줄여서 싣는다 (긴 변 1568px JPEG) */
let sharp = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  /* 없으면 받은 그대로 */
}
const inline = new Map();
for (const x of todo.filter((x) => prev[x.file]?.failed)) {
  try {
    const res = await fetch(imageUrl(x), { signal: AbortSignal.timeout(30_000), headers: { "user-agent": "Mozilla/5.0 (sapphire guild wiki)" } });
    if (!res.ok) continue;
    let buf = Buffer.from(await res.arrayBuffer());
    let type = res.headers.get("content-type") || "image/png";
    if (sharp) {
      buf = await sharp(buf, { animated: false }).resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      type = "image/jpeg";
    }
    inline.set(x.file, { type, data: buf.toString("base64") });
  } catch {
    /* 이번에도 못 받으면 주소로 */
  }
}

function userContent(x) {
  const where = (x.usedBy ?? [])
    .slice(0, 4)
    .map((t) => `${ko.get(t)?.ko ?? t} (${t})`)
    .join(", ");
  return [
    inline.has(x.file)
      ? { type: "image", source: { type: "base64", media_type: inline.get(x.file).type, data: inline.get(x.file).data } }
      : { type: "image", source: { type: "url", url: imageUrl(x) } },
    { type: "text", text: `위키 파일 이름: ${x.file}\n이 그림이 쓰인 위키 문서: ${where || "(없음)"}\n\n이 그림을 형식대로 판단하고 옮겨 줘.` },
  ];
}

if (DRY) {
  console.log(JSON.stringify({ candidates: todo.length, mb: Math.round(todo.reduce((t, x) => t + (x.size ?? 0), 0) / 1e6), junk: images.filter(isJunk).length, sample: todo.slice(0, 3).map(imageUrl) }));
  process.exit(0);
}

const ws = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
const client = new Anthropic({ apiKey: key, maxRetries: 4, ...(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {}) });

let batchId = RESUME;
if (!batchId) {
  if (!items.length) {
    console.log("볼 그림이 없어요 (모두 봄)");
    writeFileSync(join(OUT, "그림글.json"), JSON.stringify(prev));
    process.exit(0);
  }
  const batch = await client.messages.batches.create({
    requests: items.map((it) => ({
      custom_id: it.id,
      params: {
        model: MODEL,
        max_tokens: 32000,
        output_config: { effort: "high" },
        system: SYSTEM,
        messages: [{ role: "user", content: userContent(byFile.get(it.file)) }],
      },
    })),
  });
  batchId = batch.id;
  console.log(`그림 ${items.length}장을 보냈어요`);
}
writeFileSync(join(OUT, "batch.json"), JSON.stringify({ id: batchId, items }));

const deadline = Date.now() + WAIT_MIN * 60_000;
let batch;
for (;;) {
  batch = await client.messages.batches.retrieve(batchId);
  if (batch.processing_status === "ended") break;
  if (Date.now() > deadline) {
    console.log("아직 처리 중이라 멈춰요. --batch 로 이어 받아요");
    writeFileSync(join(OUT, "그림글.json"), JSON.stringify(prev));
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 60_000));
}

const out = { ...prev };
const at = new Date().toISOString().slice(0, 10);
let ok = 0;
let useful = 0;
let failed = 0;
const usage = { in: 0, out: 0 };
for await (const r of await client.messages.batches.results(batchId)) {
  const file = byId.get(r.custom_id);
  if (!file) continue;
  const x = byFile.get(file);
  const articlesOf = (x?.usedBy ?? []).slice(0, 6);
  if (r.result.type !== "succeeded" || r.result.message.stop_reason === "refusal" || r.result.message.stop_reason === "max_tokens") {
    failed++;
    out[file] = { failed: r.result.type === "succeeded" ? r.result.message.stop_reason : r.result.type, articles: articlesOf, at };
    continue;
  }
  const msg = r.result.message;
  usage.in += msg.usage.input_tokens ?? 0;
  usage.out += msg.usage.output_tokens ?? 0;
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const cut = text.search(/^---\s*$/m);
  const head = cut >= 0 ? text.slice(0, cut) : text;
  const body = cut >= 0 ? text.slice(cut).replace(/^---\s*\n?/, "").trim() : "";
  const field = (k) => head.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
  const isUseful = /^예/.test(field("쓸모"));
  out[file] = { useful: isUseful, kind: field("종류"), desc: field("설명"), text: isUseful ? body : "", articles: articlesOf, model: MODEL, at };
  ok++;
  if (isUseful) useful++;
}
writeFileSync(join(OUT, "그림글.json"), JSON.stringify(out));
console.log(`본 그림 ${ok}장 (쓸모 ${useful}장), 실패 ${failed}장, 토큰 입력 ${usage.in} · 출력 ${usage.out}`);
