// 답 받기 일꾼 (제작자 2026-11-05 '답을 하다 끊냐?', '내가 웹 꺼도 되게 하랬지'): 챗봇 답을 화면 연결과 상관없이 끝까지 받는다.
//
// Pages Functions 는 화면 연결이 끊기면 30초만 더 일하고 멈춰서, 길게 생각하는 답(effort high, 웹 찾기)은 앱을 닫으면 사라졌다.
// 이 일꾼은 따로 배포한 Worker(web/runner, sapphire-chat-runner)의 Durable Object 라서 알람 하나로 15분까지 답을 받는다 (Cloudflare 무료 요금제).
// - 대화마다 일꾼 하나 (idFromName 'thread:<대화 번호>'). /start 가 받을 일을 맡기고 알람을 바로 울려 알람 안에서 Claude API 를 부른다
//   (알람은 부른 쪽 연결과 상관없이 돈다).
// - 받은 SSE 를 그대로 모아 두고, 보고 있는 화면(/start 의 답, /watch 로 다시 붙은 화면)에 흘려보낸다. 다시 붙으면 처음부터 다시 보낸다.
// - 다 받으면 일꾼이 답을 대화에 넣고(생각, 걸린 시간, 찾은 자료, 웹 찾기, 출처까지) 'sapphire_saved' 줄로 번호를 알린다.
//   그때 보고 있는 화면이 없으면 '답변 완료' 알림을 보낸다 (폰 알림까지).
// - /stop (화면의 중지) 은 받기를 멈추고 넣지 않는다 (화면이 받은 데까지 넣는다). 같은 대화에 새로 물으면 앞의 것을 멈춘다.
import { DurableObject } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./auth";
import { notify } from "./alerts";
import { GAP_TOKEN, MAX_ANSWER, MAX_THINKING, addMsg, recordGap } from "./chatlog";
import { errorCause, errorText, isWebOff } from "./chatErrors";
import { rememberAnswer } from "./chatCache";

/** 일꾼에게 맡기는 것 (functions/api/chat/index.ts 가 보낸다) */
export interface RunStart {
  meta: {
    userId: string;
    threadId: number;
    /** 질문 앞부분 (알림 글) */
    question: string;
    /** 화면이 고른 위키 자료 이름들 ('📚 아이모 자료 둘러봄') */
    found: string;
    /** 오늘(한국 날짜): 답을 못 받으면 질문 수를 되돌린다 */
    day: string;
    developer: boolean;
    /** 위키 자료가 질문 뒤에 따라온다 (/context). CONTEXT_WAIT_MS 까지 기다렸다가 붙이고, 안 오면(앱을 껐다) 없이 답한다 */
    waitContext?: boolean;
    /** 같은 글 답 다시 쓰기 열쇠 (server/chatCache.ts): 도감·시세 칸이 든 답이면 적어 둔다 */
    cacheKey?: string;
  };
  /** Claude API 요청 (stream 은 일꾼이 붙인다) */
  params: Record<string, unknown>;
  key: string;
  workspace?: string;
  /** 로컬 시험에서만: 가짜 API 주소 */
  baseURL?: string;
}

interface Job {
  start: RunStart;
  chunks: Uint8Array[];
  watchers: Set<ReadableStreamDefaultController<Uint8Array>>;
  ctrl: AbortController;
  startedAt: number;
  firstTextAt: number | null;
  begun: boolean;
  done: boolean;
  stopped: boolean;
  /** 뒤따라온 위키 자료 */
  ctx: { text: string; found: string } | null;
  ctxWait: (() => void) | null;
}

/**
 * 위키 자료를 기다리는 가장 긴 때. 화면이 자료를 고르는 데 걸리는 시간(사진 읽기 10~30초, 느린 폰·망에서 글 본문 1.4MB 받기)보다 길어야 한다
 * (챗봇 개선 2026-11-10: 25초였을 때 사진 질문과 느린 폰의 질문이 자료 없이 답해 '요새·미로·죽늪 몬스터 자료 없음' 같은 [[모름]]이 쌓였다).
 * 앱을 껐으면(자료가 안 오면) 이만큼 기다린 뒤 자료 없이 답한다. 화면은 자료 고르기가 실패해도 빈 자료를 바로 보내 기다리지 않게 한다
 */
const CONTEXT_WAIT_MS = 120_000;

/** 한 번 답에 쓰는 가장 긴 때 (알람은 15분까지) */
const MAX_RUN_MS = 14 * 60_000;
/** 마지막 질문의 맨 끝(질문 글) 바로 앞에 <위키 자료> 를 넣는다 */
function withContext(params: Record<string, unknown>, text: string): Record<string, unknown> {
  const messages = [...((params.messages ?? []) as { role: string; content: unknown }[])];
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return params;
  const block = { type: "text", text: `<위키 자료>\n${text}\n</위키 자료>` };
  const content = Array.isArray(last.content) ? [...last.content] : [{ type: "text", text: String(last.content) }];
  content.splice(Math.max(0, content.length - 1), 0, block);
  messages[messages.length - 1] = { ...last, content };
  return { ...params, messages };
}

/** pause_turn 뒤 이어 묻는 횟수 (시간 14분이 실제 한도. 무한히 돌지 않게만) */
const MAX_ROUNDS = 30;

const joinText = (chunks: Uint8Array[]) => {
  const d = new TextDecoder();
  return chunks.map((c) => d.decode(c, { stream: true })).join("") + d.decode();
};

/**
 * 한 회차 SSE 에서 답 블록을 그대로 다시 만든다 (pause_turn 뒤 assistant 로 돌려보내 이어 묻기).
 * 생각(서명 포함), 글(인용 포함), 서버 도구 호출과 결과를 받은 그대로
 */
export function contentFromSse(raw: string): { blocks: Record<string, unknown>[]; stop: string | null } {
  const blocks: Record<string, unknown>[] = [];
  const json = new Map<number, string>();
  let stop: string | null = null;
  for (const chunk of raw.replace(/\r\n/g, "\n").split("\n\n")) {
    const data = chunk
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    let ev: { type: string; index?: number; content_block?: Record<string, unknown>; delta?: Record<string, unknown> };
    try {
      ev = JSON.parse(data);
    } catch {
      continue;
    }
    const i = ev.index ?? -1;
    if (ev.type === "content_block_start" && ev.content_block) {
      blocks[i] = { ...ev.content_block };
      if (ev.content_block.type === "server_tool_use" || ev.content_block.type === "tool_use") json.set(i, "");
    } else if (ev.type === "content_block_delta" && ev.delta && blocks[i]) {
      const b = blocks[i];
      const d = ev.delta;
      if (d.type === "text_delta") b.text = String(b.text ?? "") + String(d.text ?? "");
      else if (d.type === "thinking_delta") b.thinking = String(b.thinking ?? "") + String(d.thinking ?? "");
      else if (d.type === "signature_delta") b.signature = d.signature;
      else if (d.type === "citations_delta") b.citations = [...((b.citations as unknown[]) ?? []), d.citation];
      else if (d.type === "input_json_delta") json.set(i, (json.get(i) ?? "") + String(d.partial_json ?? ""));
    } else if (ev.type === "content_block_stop" && json.has(i) && blocks[i]) {
      try {
        blocks[i].input = JSON.parse(json.get(i) || "{}");
      } catch {
        blocks[i].input = {};
      }
    } else if (ev.type === "message_delta" && ev.delta?.stop_reason) stop = String(ev.delta.stop_reason);
  }
  return { blocks: blocks.filter(Boolean), stop };
}

const enc = new TextEncoder();
const line = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

const SSE_HEADERS = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" };

/** API 오류를 화면이 읽는 SSE 오류 줄로 (화면 src/chat.ts 가 sapphire 면 글을 그대로 보인다) */
function errorLine(e: unknown, developer: boolean) {
  const type =
    e instanceof Anthropic.RateLimitError
      ? "rate_limit_error"
      : e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError
        ? "authentication_error"
        : e instanceof Anthropic.BadRequestError
          ? "invalid_request_error"
          : "api_error";
  return line({ type: "error", sapphire: true, error: { type, message: errorText(e) + (developer ? errorCause(e) : "") } });
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

interface Step {
  kind: "search" | "fetch" | "code";
  text: string;
}

/**
 * 받은 SSE 에서 답, 생각, 웹 찾기, 출처를 뽑는다 (화면 src/chat.ts askChat 과 같은 규칙. 화면이 다 받고 저장하던 것을 일꾼이 한다)
 */
export function summarizeSse(raw: string) {
  let text = "";
  let thinking = "";
  let lastType = "";
  let wrote = false;
  let finished = false;
  let stop: string | null = null;
  const steps: Step[] = [];
  const sources: { url: string; title: string }[] = [];
  const blocks = new Map<number, { type: string; name?: string; json: string }>();
  const addSource = (url: string, title?: string) => {
    if (!sources.some((s) => s.url === url)) sources.push({ url, title: title || host(url) });
  };
  const addStep = (step: Step) => {
    const prev = steps[steps.length - 1];
    if (step.kind === "search" && step.text.startsWith("결과 ") && prev?.kind === "search") prev.text += ` · ${step.text}`;
    else steps.push(step);
  };
  for (const chunk of raw.replace(/\r\n/g, "\n").split("\n\n")) {
    const data = chunk
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    let ev: {
      type: string;
      index?: number;
      content_block?: { type: string; name?: string; content?: unknown };
      delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string | null; citation?: { url?: string; title?: string } };
    };
    try {
      ev = JSON.parse(data);
    } catch {
      continue;
    }
    if (ev.type === "content_block_start" && ev.content_block) {
      const b = ev.content_block;
      blocks.set(ev.index ?? -1, { type: b.type, name: b.name, json: "" });
      if (b.type === "text" && wrote && lastType !== "text" && lastType !== "thinking") text += "\n\n";
      lastType = b.type;
      if (b.type === "web_fetch_tool_result" && b.content && typeof b.content === "object") {
        const r = b.content as { url?: string; content?: { title?: string } };
        if (r.url) addSource(r.url, r.content?.title);
      }
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) addStep({ kind: "search", text: `결과 ${b.content.length}개` });
    } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
      wrote = true;
      text += ev.delta.text;
    } else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta" && ev.delta.thinking) thinking += ev.delta.thinking;
    else if (ev.type === "content_block_delta" && ev.delta?.type === "input_json_delta" && ev.delta.partial_json) {
      const b = blocks.get(ev.index ?? -1);
      if (b) b.json += ev.delta.partial_json;
    } else if (ev.type === "content_block_delta" && ev.delta?.type === "citations_delta" && ev.delta.citation?.url) {
      addSource(ev.delta.citation.url, ev.delta.citation.title);
    } else if (ev.type === "content_block_stop") {
      const b = blocks.get(ev.index ?? -1);
      if (b?.type === "server_tool_use") {
        let input: { query?: string; url?: string } = {};
        try {
          input = JSON.parse(b.json || "{}");
        } catch {
          // 입력을 못 읽어도 한 일은 남긴다
        }
        if (b.name === "web_search") addStep({ kind: "search", text: input.query ? `“${input.query}”` : "웹 찾기" });
        else if (b.name === "web_fetch") addStep({ kind: "fetch", text: input.url ? host(input.url) : "글 읽기" });
        else addStep({ kind: "code", text: "찾은 것 거르기" });
      }
    } else if (ev.type === "message_delta" && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
    else if (ev.type === "message_stop") finished = true;
  }
  return { text, thinking, steps, sources, finished, stop };
}

export class ChatRun extends DurableObject<Env> {
  private job: Job | null = null;

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/start" && request.method === "POST") {
      const start = (await request.json()) as RunStart;
      if (this.job && !this.job.done) this.finish(this.job, true); // 같은 대화에 새로 물으면 앞의 것은 멈춘다
      const job: Job = {
        start,
        chunks: [],
        watchers: new Set(),
        ctrl: new AbortController(),
        startedAt: Date.now(),
        firstTextAt: null,
        begun: false,
        done: false,
        stopped: false,
        ctx: null,
        ctxWait: null,
      };
      this.job = job;
      const res = this.watch(job);
      // 알람 안에서 받는다: 부른 쪽(화면)의 연결이 끊겨도 알람은 15분까지 돈다
      await this.ctx.storage.setAlarm(Date.now());
      return res;
    }
    if (path === "/watch") {
      if (!this.job) return new Response(null, { status: 204 });
      return this.watch(this.job);
    }
    if (path === "/context" && request.method === "POST") {
      const c = (await request.json()) as { text?: string; found?: string };
      if (!this.job || this.job.done) return new Response("late", { status: 409 });
      this.job.ctx = { text: String(c.text ?? ""), found: String(c.found ?? "") };
      this.job.ctxWait?.();
      return new Response("ok");
    }
    if (path === "/stop" && request.method === "POST") {
      if (this.job && !this.job.done) this.finish(this.job, true);
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const job = this.job;
    if (!job || job.begun || job.done) return;
    job.begun = true;
    await this.run(job);
  }

  /** 지금까지 받은 것을 처음부터 보내고, 받는 중이면 이어서 흘려보낸다 */
  private watch(job: Job): Response {
    let me: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        me = c;
        for (const chunk of job.chunks) c.enqueue(chunk);
        if (job.done) c.close();
        else job.watchers.add(c);
      },
      cancel: () => {
        if (me) job.watchers.delete(me);
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  }

  private push(job: Job, chunk: Uint8Array) {
    job.chunks.push(chunk);
    for (const c of job.watchers) {
      try {
        c.enqueue(chunk);
      } catch {
        job.watchers.delete(c); // 끊긴 화면
      }
    }
  }

  /** 끝: 보고 있는 화면을 닫는다. stop 이면 API 받기도 멈춘다 */
  private finish(job: Job, stop = false) {
    if (job.done) return;
    job.done = true;
    if (stop) {
      job.stopped = true;
      job.ctrl.abort();
    }
    for (const c of job.watchers) {
      try {
        c.close();
      } catch {
        // 이미 닫힘
      }
    }
    job.watchers.clear();
  }

  private async run(job: Job): Promise<void> {
    const { start } = job;
    const { meta } = start;
    // 알람은 15분까지라 자료를 기다린 시간도 한 번 답의 한도(MAX_RUN_MS)에 넣는다
    const deadline = Date.now() + MAX_RUN_MS;
    // 위키 자료를 기다려 질문 바로 앞에 붙인다 (화면이 질문을 먼저 보냈다)
    if (meta.waitContext) {
      if (!job.ctx) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, CONTEXT_WAIT_MS);
          job.ctxWait = () => {
            clearTimeout(t);
            resolve();
          };
        });
        job.ctxWait = null;
      }
      if (job.stopped) return;
      if (job.ctx?.found) meta.found = job.ctx.found;
      if (job.ctx?.text) start.params = withContext(start.params, job.ctx.text);
    }
    const env = this.env;
    const timer = setTimeout(() => job.ctrl.abort(), Math.max(1000, deadline - Date.now()));
    const client = new Anthropic({
      apiKey: start.key,
      ...(start.baseURL ? { baseURL: start.baseURL } : {}),
      ...(start.workspace ? { defaultHeaders: { "anthropic-workspace-id": start.workspace } } : {}),
    });
    const ask = (params: Record<string, unknown>) =>
      client.beta.messages
        .create({ ...params, stream: true } as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming, { signal: job.ctrl.signal })
        .asResponse();
    const refund = () =>
      env.DB.prepare("UPDATE chat_usage SET count = count - 1 WHERE user_id = ? AND day = ? AND count > 0")
        .bind(meta.userId, meta.day)
        .run()
        .catch(() => undefined);

    let upstream: Response;
    try {
      try {
        upstream = await ask(start.params);
      } catch (e) {
        // 웹 찾기를 쓸 수 없는 계정이면 (콘솔에서 꺼 둔 경우) 웹 없이 답한다
        if (!isWebOff(e) || job.stopped) throw e;
        console.error("chat run without web", String((e as Error).message).slice(0, 200));
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { tools, ...rest } = start.params;
        this.push(job, line({ type: "sapphire_web_off" }));
        upstream = await ask(rest);
      }
    } catch (e) {
      clearTimeout(timer);
      if (job.stopped) return;
      console.error("chat run request failed", e instanceof Anthropic.APIError ? e.status : e);
      await refund();
      this.push(job, errorLine(e, meta.developer));
      const watched = job.watchers.size > 0;
      this.finish(job);
      if (!watched) await this.tell(meta, "끊김");
      return;
    }

    const dec = new TextDecoder();
    // 웹 찾기를 오래 하면 API 가 답을 잠깐 멈춘다 (stop_reason pause_turn). 받은 내용을 그대로 붙여 다시 물어 이어 간다
    // (챗봇 개선 2026-11-09, 제작자 '한도를 왜 두는 거야? 안 두면 안 돼?': 찾기·읽기 횟수 한도를 없애고, 멈추면 이어서. 14분이 넘으면 거기까지)
    const sent = (start.params.messages ?? []) as unknown[];
    const said: unknown[] = []; // 앞 회차들에 받은 답 블록 (이어 물을 때 assistant 로)
    for (let round = 0; ; round++) {
      const roundChunks: Uint8Array[] = [];
      try {
        const reader = upstream.body!.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.length) continue;
          this.push(job, value);
          roundChunks.push(value);
          if (job.firstTextAt === null && dec.decode(value, { stream: true }).includes('"text_delta"')) job.firstTextAt = Date.now();
        }
      } catch (e) {
        if (!job.stopped) console.error("chat run stream broke", e instanceof Error ? e.message : e);
        break;
      }
      if (job.stopped || round >= MAX_ROUNDS) break;
      const got = contentFromSse(joinText(roundChunks));
      if (got.stop !== "pause_turn" || !got.blocks.length) break;
      said.push(...got.blocks);
      try {
        upstream = await ask({ ...start.params, messages: [...sent, { role: "assistant", content: said }] });
      } catch (e) {
        if (!job.stopped) console.error("chat run continue failed", e instanceof Anthropic.APIError ? e.status : e);
        break;
      }
    }
    clearTimeout(timer);
    if (job.stopped) return; // 화면이 중지했거나 같은 대화에 새로 물었다: 넣지 않는다

    // 다 받았다: 답을 대화에 넣는다
    const size = job.chunks.reduce((n, c) => n + c.length, 0);
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of job.chunks) {
      all.set(c, at);
      at += c.length;
    }
    const got = summarizeSse(new TextDecoder().decode(all));
    let savedId: number | null = null;
    if (got.finished && got.text.trim()) {
      try {
        savedId = await addMsg(env, meta.threadId, "assistant", got.text.slice(0, MAX_ANSWER), {
          thinking: got.thinking.slice(0, MAX_THINKING) || null,
          thinkMs: Math.max(0, (job.firstTextAt ?? Date.now()) - job.startedAt),
          found: meta.found.slice(0, 400) || null,
          steps: got.steps.length ? JSON.stringify(got.steps.slice(0, 20)) : null,
          sources: got.sources.length ? JSON.stringify(got.sources.slice(0, 20)) : null,
        });
        // 길잡이가 짐작했거나 자료가 없다고 표시했으면 앱개발자에게 (제작자 요청)
        const gaps = [...got.text.matchAll(GAP_TOKEN)].map((m) => m[1].trim()).filter(Boolean);
        if (gaps.length) await recordGap(env, meta.userId, meta.threadId, savedId, got.text, gaps.join(" / "), "bot");
        await rememberAnswer(env, meta.cacheKey, savedId, got.text).catch(() => undefined);
      } catch (e) {
        console.error("chat run save failed", e);
      }
    }
    if (savedId !== null) this.push(job, line({ type: "sapphire_saved", id: savedId }));
    const watched = job.watchers.size > 0;
    this.finish(job);
    // 보고 있는 화면이 없으면 알린다 (폰 알림까지)
    if (!watched) await this.tell(meta, savedId !== null ? "완료" : "끊김");
  }

  private async tell(meta: RunStart["meta"], how: "완료" | "끊김") {
    const q = meta.question.replace(/\s+/g, " ").slice(0, 40) || "첨부 질문";
    const text = how === "완료" ? `답변이 준비됐어요: “${q}”` : `답을 만들다 끊겼어요: “${q}” · 다시 물어봐 주세요`;
    await notify(this.env, [meta.userId], "chat_done", text, `#/chat/${meta.threadId}`, "").catch((e) => console.error("chat run notify failed", e));
  }
}
