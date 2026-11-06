// 챗봇 답 시험 (제작자 2026-11-06 '유물깡에 대한 질문하고 테스트도 해 보고'): 실서비스 D1 의 공식 글·그림 글자와 과금 계산 자료로 진짜 챗봇과 같은 지시문·모델에 묻고 답을 찍는다.
// 공개 저장소의 실행 기록에 찍히므로 길드 앱 자료(길드원 명단, 거래, 사용 기록)와 위키 자료(비공개)는 붙이지 않는다: 공식 홈페이지의 공개 글과 계산 자료만.
// GitHub Actions(.github/workflows/chat-test.yml)에서 손으로 돌린다.
//   node --import ./scripts/ts-hooks.mjs --experimental-strip-types scripts/chat-test.mjs "유물깡 정리해줘"
import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { officialContext } from "../server/official.ts";
import { costContext } from "../server/chatCost.ts";
import { CHAT_SYSTEM } from "../server/chatPrompt.ts";

const DB = "sapphire-accounts";
const question = process.argv.slice(2).join(" ").trim();
if (!question) throw new Error("질문을 주세요");
const key = process.env.ANTHROPIC_API_KEY?.trim();
if (!key) throw new Error("ANTHROPIC_API_KEY 가 없어요");

const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const wrangler = (...args) => execFileSync(process.execPath, [WRANGLER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 256 * 1024 * 1024 });
const parseJson = (text) => JSON.parse(text.slice(text.search(/[[{]/)));
{
  const toml = readFileSync("wrangler.toml", "utf8");
  if (/^database_id = "0{8}-/m.test(toml)) {
    const id = parseJson(wrangler("d1", "list", "--json")).find((d) => d.name === DB)?.uuid;
    writeFileSync("wrangler.toml", toml.replace(/^database_id = ".*"$/m, `database_id = "${id}"`));
  }
}
const lit = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
/** D1 바인딩 흉내 (값을 SQL 에 글자로 넣어 wrangler 로 부른다) */
const env = {
  DB: {
    prepare(sql) {
      let args = [];
      const run = () => {
        let i = 0;
        const text = /\?\d/.test(sql) ? sql.replace(/\?(\d+)/g, (_, n) => lit(args[Number(n) - 1])) : sql.replace(/\?/g, () => lit(args[i++]));
        return parseJson(wrangler("d1", "execute", DB, "--remote", "--json", "--command", text))[0]?.results ?? [];
      };
      const st = {
        bind: (...a) => ((args = a), st),
        all: async () => ({ results: run() }),
        first: async () => run()[0] ?? null,
      };
      return st;
    },
  },
};

const [official, cost] = await Promise.all([officialContext(env, question), costContext(env, question)]);
console.log(`붙은 자료: 공식 소식 ${official.length}자, 과금 계산 자료 ${cost.length}자`);
for (const m of official.matchAll(/\[공식 글 본문[^\]]*\]/g)) console.log("  " + m[0]);
const content = [];
if (official) content.push({ type: "text", text: `<컴투스 공식 소식>\n${official}\n</컴투스 공식 소식>` });
if (cost) content.push({ type: "text", text: `<과금 계산 자료>\n${cost}\n</과금 계산 자료>` });
content.push({ type: "text", text: question });

const ws = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
const client = new Anthropic({ apiKey: key, maxRetries: 3, ...(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {}) });
const started = Date.now();
const res = await client.beta.messages
  .stream({
    model: "claude-opus-5-5",
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: "high" },
    system: [{ type: "text", text: CHAT_SYSTEM }],
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 5 },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 },
    ],
    messages: [{ role: "user", content }],
  })
  .finalMessage();
const used = res.content.filter((b) => b.type === "server_tool_use").map((b) => `${b.name} ${JSON.stringify(b.input).slice(0, 80)}`);
console.log(`\n질문: ${question}\n걸린 시간 ${Math.round((Date.now() - started) / 1000)}초 · ${res.stop_reason} · 입력 ${res.usage.input_tokens} 출력 ${res.usage.output_tokens}${used.length ? `\n웹: ${used.join(" / ")}` : ""}\n`);
console.log("=== 답 ===\n" + res.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
