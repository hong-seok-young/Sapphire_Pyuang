// 시세 동향 AI 검수 (제작자 2026-11-18 '규칙 스크립트는 문맥 파악이 안 되잖아, 무조건 AI 가 껴야 오차가 없어').
// build_trend.py 가 규칙으로 읽은 뒤 AI 답이 없는 글을 .trend-ai/todo.json 에 적는다 (글, 앞뒤 대화, 규칙이 읽은 것).
// 이 스크립트가 계정 DB(D1 trend_ai)의 답을 .trend-ai/cache.json 으로 받고, 아직 없는 글을 Claude 에게 묻고(묶음마다, 여러 개 같이),
// 답을 D1 에 넣는다. 배포(deploy-web.yml 'Trend AI review')가 이 다음 build_trend.py 를 다시 돌리면 AI 답으로 센다.
// 공개 저장소의 실행 기록이라 글·닉네임은 찍지 않고 수만 찍는다. 실패해도 배포는 이어진다 (그 글은 규칙대로, 다음 배포에 다시).
//   node scripts/trend-ai.mjs pull      -> D1 답을 cache.json 으로
//   node scripts/trend-ai.mjs           -> pull + 묻기 (TREND_AI_BUDGET 초, 기본 720) -> GITHUB_OUTPUT 에 added, left
import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DB = "sapphire-accounts";
const DIR = process.env.TREND_AI_DIR ?? fileURLToPath(new URL("../.trend-ai/", import.meta.url));
const MODEL = "claude-opus-5-5";
const BATCH = 20;
const PARALLEL = Number(process.env.TREND_AI_PARALLEL ?? 10);
const BUDGET_MS = Number(process.env.TREND_AI_BUDGET ?? 720) * 1000;
const started = Date.now();

const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const wrangler = (...args) => execFileSync(process.execPath, [WRANGLER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
const parseJson = (text) => JSON.parse(text.slice(text.search(/[[{]/)));
const where = process.env.TREND_AI_LOCAL ? ["--local", "--persist-to", process.env.TREND_AI_LOCAL] : ["--remote"];
const select = (sql) => parseJson(wrangler("d1", "execute", DB, ...where, "--json", "--command", sql))[0]?.results ?? [];
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const output = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
function runFile(sql) {
  const f = `${DIR}put.sql`;
  writeFileSync(f, sql);
  try {
    wrangler("d1", "execute", DB, ...where, "--yes", `--file=${f}`);
  } finally {
    rmSync(f, { force: true });
  }
}

// wrangler.toml 의 database_id 자리표시를 채운다 (scripts/digest-official.mjs 와 같다)
if (!process.env.TREND_AI_LOCAL) {
  const toml = readFileSync("wrangler.toml", "utf8");
  if (/^database_id = "0{8}-/m.test(toml)) {
    const id = parseJson(wrangler("d1", "list", "--json")).find((d) => d.name === DB)?.uuid;
    if (id) writeFileSync("wrangler.toml", toml.replace(/^database_id = ".*"$/m, `database_id = "${id}"`));
  }
}

mkdirSync(DIR, { recursive: true });
const cache = {};
try {
  select("CREATE TABLE IF NOT EXISTS trend_ai (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)");
  for (let after = ""; ; ) {
    const rows = select(`SELECT k, v FROM trend_ai WHERE k > ${q(after)} ORDER BY k LIMIT 3000`);
    for (const r of rows) cache[r.k] = JSON.parse(r.v);
    if (rows.length < 3000) break;
    after = rows[rows.length - 1].k;
  }
} catch (e) {
  console.log("시세 동향 AI 검수: 계정 DB 를 못 읽었어요", e instanceof Error ? e.message.slice(0, 120) : "");
}
writeFileSync(`${DIR}cache.json`, JSON.stringify(cache));
console.log(`시세 동향 AI 검수: 받아 둔 답 ${Object.keys(cache).length}개`);
if (process.argv[2] === "pull") process.exit(0);

const todoFile = `${DIR}todo.json`;
if (!existsSync(todoFile)) {
  console.log("시세 동향 AI 검수: 물을 목록이 없어요 (build_trend.py 먼저)");
  process.exit(0);
}
const todo = JSON.parse(readFileSync(todoFile, "utf8"));
const waiting = todo.todo.filter((t) => !cache[t.key]);
const key = process.env.ANTHROPIC_API_KEY;
if (!key || !waiting.length) {
  console.log(`시세 동향 AI 검수: 물을 것 ${waiting.length}개${key ? "" : " (ANTHROPIC_API_KEY 없음)"}`);
  output("added", 0);
  output("left", waiting.length);
  process.exit(0);
}
const ws = process.env.ANTHROPIC_WORKSPACE_ID;
const client = new Anthropic({ apiKey: key, maxRetries: 4, timeout: 600_000, ...(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {}) });

const SYSTEM = `너는 모바일 게임 '아이모(IMO)' 거래 오픈톡방의 글을 읽고 물건 시세를 뽑는 사람이야. 규칙 스크립트가 먼저 읽은 것(rule)을 글과 앞뒤 대화(context)를 보고 바로잡아.
글마다 그 글에서 실제로 값을 부른 물건만 items 로 돌려줘. 규칙이 맞으면 그대로, 틀리면 고치고, 놓친 것은 더하고, 물건 값이 아닌 것은 뺀다.

단위와 값
- 장 = 콩 = 냥 = 현금 만 원. '만', '만원'도 만 원. unit "won", price 는 만 원 수 (0.5장 = 0.5, 6700원 = 0.67).
- '만골', '만 골드', '천골'(= 0.1만 골드), '골드'로 적은 값은 골드. unit "gold", price 는 만 골드 수 (4천골 = 0.4, 15만골 = 15, 4000골 = 0.4). 골드 시세는 보통 1만 원 = ${todo.rate}만 골드.
- 단위 없이 숫자만 적은 값은 문맥으로 정해: 같은 사람·같은 글이 단위를 밝혔으면 그 단위, '단위 만 골드'·'골드에만 판매' 같은 말, 물건의 흔한 값(현금 몇 만 원대인지, 재료·주화처럼 골드로 사고파는 물건인지). 정말 모르면 현금 만 원.
- 값 범위 '80-95' 는 가운데 값. '개당', 'N개 값', 'N개합 값' 은 한 개 값으로 나눈 price 와 count(묶음 개수). 개수 모를 묶음 값('한통 5냥')은 뺀다.
- 여러 물건을 합친 값 하나('A+B 80', '합쳐서', '일괄', '같이'), 바꾸자는 글('->', '교환'), 남에게 답하는 글('@닉'), 잡담·장난('광부 15장 줄서봅니다' 같은 농담), 이미 판 것 자랑은 뺀다.

물건이 아닌 것
- 캐릭터 판매 글: 캐릭터를 통으로 파는 값('통 600', '캘 300장', '몸 800')과 그 캐릭터가 가진 장비·도감·스펙 목록은 물건 값이 아니다. '보유', '소지', '장착 중' 줄도 아니다.
  단, '각개'·'아이템 판매'처럼 따로 판다고 한 물건의 값은 센다.
- 골드 시세 글('골드 75:1 3장', '골드 만원치 삽니다')은 물건이 아니다 (따로 센다).
- 끝난 이벤트 물건(헌터카드, 고급헌터증서)과 빼기로 한 이름(${(todo.drop ?? []).join(", ")}), 무엇인지 모를 한두 글뿐인 이름은 뺀다.

사고파는 쪽 (side): 줄에 적힌 말 > 그 문단의 머리 줄('#삽니다', '왕국 팝니다') > 글 전체. 팝·팜·ㅍ·판매 = sell, 삽·구매·구함·ㅅ·줄서 = buy. 쪽을 안 적었으면 sell.

물건 이름 (name)
- 줄임말은 아래 줄임말 표와 이름 목록으로 정식 이름으로 (닼 = 다크, 롭 = 로브, '8헌보' = +8 헌터보우, '팔닼소' = +8 다크스틸소드). 이름 목록에 있으면 그 글자 그대로.
- 규칙이 정한 이름 모양(코스튬은 '… (코스튬)', 펫은 name "펫" 과 pet 에 펫 이름, 보석 '시프넬의자수정 (2단계)', 스킬북 '화염폭풍 2단', 직업마다 다른 장비 묶음 '바슬신 (Lv.44 신발)')을 따른다.
- 이름을 정말 모르면 적힌 그대로 (띄어쓰기 없이).
강화 (enh): '+8', '8강', '팔', 앞의 한 자리 숫자('8닼'). 노강 = 0.
옵션 (opts): ['명중9', '힘7', '크리3', '민첩2', '지능3', '체력30', '마나20', '이속5', '속저9', '마재2', '체재1', '불저3' …] 처럼 옵션 이름 + 값. 체·마 1~3 은 속성부여 10/20/30 (체3 = 체력30).
  '334' 처럼 옵션을 숫자만 늘어놓았으면 규칙이 읽은 옵션을 참고해.
line: 그 물건 값이 적힌 원글 줄 그대로.
sure: 물건 이름·강화·옵션·값(단위까지)·사고파는 쪽을 글과 문맥으로 확실히 알 때만 true. 하나라도 짐작이면 false 로 하고 why 에 무엇이 애매한지 한 줄
  (예: '단위 없는 숫자 20 이 만 원인지 만 골드인지 모름', '줄임말 쿠찌가 무엇인지 모름', '값이 묶음 값인지 개당인지 모름'). sure 가 false 인 것은 시세에 넣지 않고 사람이 나중에 확인해. 확실하면 why 는 빈 글.

규칙이 읽은 것(rule)의 unit '모름(단위 없는 숫자)' 은 규칙이 단위를 몰라 일단 만 원으로 둔 값이야.

줄임말 표 (줄임말 -> 정식 이름):
${Object.entries(todo.slang).map(([k, v]) => `${k}=${v}`).join(", ")}

이름 목록:
${todo.names.join(", ")}`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["messages"],
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "items"],
        properties: {
          key: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["line", "side", "name", "enh", "opts", "price", "unit", "count", "pet", "sure", "why"],
              properties: {
                line: { type: "string" },
                side: { type: "string", enum: ["sell", "buy"] },
                name: { type: "string" },
                enh: { type: "integer" },
                opts: { type: "array", items: { type: "string" } },
                price: { type: "number" },
                unit: { type: "string", enum: ["won", "gold"] },
                count: { type: "integer" },
                pet: { type: "string" },
                sure: { type: "boolean" },
                why: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

async function ask(batch) {
  const user = `글 ${batch.length}개 (key 마다 답해 줘):\n${JSON.stringify(batch.map((t) => ({ key: t.key, date: t.date, time: t.time, who: t.who, text: t.text, context: t.context, rule: t.rule })))}`;
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 32000,
    output_config: { effort: "high", format: { type: "json_schema", schema } },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") throw new Error(res.stop_reason);
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const got = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)).messages ?? [];
  const keys = new Set(batch.map((t) => t.key));
  return got.filter((m) => keys.has(m.key));
}

const batches = [];
for (let i = 0; i < waiting.length; i += BATCH) batches.push(waiting.slice(i, i + BATCH));
let added = 0;
let failed = 0;
let next = 0;
const pending = [];
async function worker() {
  while (next < batches.length && Date.now() - started < BUDGET_MS) {
    const batch = batches[next++];
    try {
      const got = await ask(batch);
      const now = Date.now();
      // 답이 빠진 글은 물건 없음으로 (같은 글을 다시 묻지 않게). 오류 묶음은 다음에 다시
      const byKey = new Map(got.map((m) => [m.key, m.items]));
      for (const t of batch) {
        const v = { items: (byKey.get(t.key) ?? []).map(({ count, pet, why, ...it }) => ({ ...it, ...(count > 1 ? { count } : {}), ...(pet ? { pet } : {}), ...(why ? { why } : {}) })) };
        cache[t.key] = v;
        pending.push(`INSERT INTO trend_ai (k, v, at) VALUES (${q(t.key)}, ${q(JSON.stringify(v))}, ${now}) ON CONFLICT (k) DO UPDATE SET v = excluded.v, at = excluded.at;`);
        added++;
      }
    } catch (e) {
      failed++;
      if (failed <= 3) console.log("시세 동향 AI 검수: 묶음 실패", e instanceof Error ? e.message.slice(0, 100) : "");
    }
    if (pending.length >= 200) flush();
  }
}
function flush() {
  if (!pending.length) return;
  const sql = pending.splice(0).join("\n");
  try {
    runFile(sql);
  } catch (e) {
    console.log("시세 동향 AI 검수: 계정 DB 에 못 넣었어요", e instanceof Error ? e.message.slice(0, 100) : "");
  }
}
await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));
flush();
writeFileSync(`${DIR}cache.json`, JSON.stringify(cache));
const left = waiting.length - added;
console.log(`시세 동향 AI 검수: 새로 읽음 ${added}개 · 남음 ${left}개 · 실패 묶음 ${failed}개 · ${Math.round((Date.now() - started) / 1000)}초`);
output("added", added);
output("left", left);
