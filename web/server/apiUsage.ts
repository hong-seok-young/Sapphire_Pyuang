// AI(Claude API) 사용량 (제작자 2026-11-13 '누가 웹과 챗봇 api 등 사용량이 많은가 대시보드'): 부를 때마다 사람·날짜·종류마다 토큰을 더한다.
// D1 api_usage. 사용 기록 대시보드(#/log, functions/api/activity.ts part=dash)가 읽는다. 전에는 질문 수(chat_usage)와 횟수(ai_usage)만 셌다.
// 사람이 아닌 일(공식 글 요약, To do 정리)은 user_id '_app'. 기록이 안 돼도 하던 일은 그대로 끝난다
import type { Env } from "./auth";
import { later } from "./background";

export interface Usage {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** 웹 찾기·글 읽기 횟수 (서버 도구) */
  web: number;
}

export const ZERO: Usage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, web: 0 };

/** 사람이 아닌 일 (공식 글 요약, To do 정리) */
export const APP_USER = "_app";

interface RawUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null; web_fetch_requests?: number | null } | null;
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** 스트리밍이 아닌 답의 usage */
export function usageOf(res: { usage?: RawUsage | null } | null | undefined): Usage {
  const u = res?.usage;
  if (!u) return { ...ZERO, calls: 1 };
  return {
    calls: 1,
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheRead: n(u.cache_read_input_tokens),
    cacheWrite: n(u.cache_creation_input_tokens),
    web: n(u.server_tool_use?.web_search_requests) + n(u.server_tool_use?.web_fetch_requests),
  };
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  calls: a.calls + b.calls,
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  web: a.web + b.web,
});

/**
 * SSE(스트리밍 답)에서 usage: 답 하나는 message_start 로 시작하고 message_delta 의 usage 는 그 답의 누적값이다.
 * pause_turn 뒤 이어 물은 회차는 답이 여럿이라 더한다. usage 가 든 줄만 JSON 으로 읽는다 (CPU 를 아끼려고)
 */
export function usageFromSse(raw: string): Usage {
  let total = { ...ZERO };
  let cur: Usage | null = null;
  const close = () => {
    if (cur) total = addUsage(total, cur);
    cur = null;
  };
  for (const ln of raw.split("\n")) {
    if (!ln.startsWith("data:") || !ln.includes('"usage"')) continue;
    const isStart = ln.includes('"message_start"');
    const isDelta = !isStart && ln.includes('"message_delta"');
    if (!isStart && !isDelta) continue;
    let ev: { type?: string; message?: { usage?: RawUsage }; usage?: RawUsage };
    try {
      ev = JSON.parse(ln.slice(5));
    } catch {
      continue;
    }
    if (ev.type === "message_start") {
      close();
      cur = usageOf(ev.message);
    } else if (ev.type === "message_delta" && ev.usage) {
      const d = usageOf({ usage: ev.usage });
      const base: Usage = cur ?? { ...ZERO, calls: 1 };
      cur = {
        calls: 1,
        input: Math.max(base.input, d.input),
        output: Math.max(base.output, d.output),
        cacheRead: Math.max(base.cacheRead, d.cacheRead),
        cacheWrite: Math.max(base.cacheWrite, d.cacheWrite),
        web: Math.max(base.web, d.web),
      };
    }
  }
  close();
  return total;
}

/** 한국 날짜 'YYYY-MM-DD' */
const kstDay = (t = Date.now()) => new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);

/** 사람·오늘·종류 줄에 더한다 (기다리지 않게 답을 보낸 뒤에, server/background.ts) */
export async function recordUsage(env: Env, userId: string, kind: string, u: Usage): Promise<void> {
  if (!u.calls && !u.input && !u.output) return;
  const work = env.DB.prepare(
    "INSERT INTO api_usage (user_id, day, kind, calls, input, output, cache_read, cache_write, web) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT (user_id, day, kind) DO UPDATE SET calls = calls + excluded.calls, input = input + excluded.input, output = output + excluded.output, " +
      "cache_read = cache_read + excluded.cache_read, cache_write = cache_write + excluded.cache_write, web = web + excluded.web",
  )
    .bind(userId, kstDay(), kind.slice(0, 30), u.calls, u.input, u.output, u.cacheRead, u.cacheWrite, u.web)
    .run()
    .catch((e) => console.error("api usage failed", e instanceof Error ? e.message : e));
  await later(work);
}

/** 스트리밍이 아닌 답 하나를 기록 (부르는 곳에서 한 줄로) */
export const trackUsage = (env: Env, userId: string, kind: string, res: { usage?: RawUsage | null } | null | undefined) =>
  recordUsage(env, userId, kind, usageOf(res));
