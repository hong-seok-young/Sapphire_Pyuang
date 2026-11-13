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

// ---------- 달러로 (제작자 2026-11-13 'AI 사용량은 달러로 표시해 줄 수 있나, 지금 216.46 달러 썼어') ----------
// Claude Opus 5.5 값 ($/백만 토큰): 입력 4 · 출력 20 · 캐시 읽기 0.2 · 캐시 쓰기(5분) 5, 웹 찾기 1번 0.01 (글 읽기는 토큰값만이라 웹 수에 같이 들어 조금 더 크게 잡힌다).
// 토큰 x ($/백만) = 백만분의 1 달러(마이크로 달러). 모든 AI 가 claude-opus-5-5 라 한 값으로 센다 (모델을 바꾸면 여기도)
export const USD_MICRO_SQL = "(input * 4 + cache_write * 5 + cache_read * 0.2 + output * 20 + web * 10000)";
export const usdOf = (r: { input: number; output: number; cr: number; cw: number; web: number }) =>
  (r.input * 4 + r.cw * 5 + r.cr * 0.2 + r.output * 20 + r.web * 10000) / 1e6;
/** 2026-11 은 콘솔에서 본 값($216.46, 11/13 제작자)에 그 뒤 앱이 센 만큼을 더한다: 배포(ci-d1 setup AI_USD_SNAP)가 그때까지 센 값을 마이크로 달러로 적어 둔다 */
export const AI_USD_BASE = { month: "2026-11", usd: 216.46 };
export const AI_USD_SNAP = "ai_usd_snap_20261113";
/**
 * 이번 달 AI 비용 (달러). 콘솔과 같게 UTC 달로 센다.
 * 1) 콘솔 값이 있으면 (GitHub Actions ai-cost.yml 이 1시간마다 ai_cost 에 적음, 제작자 2026-11-13 '클로드 콘솔 연결해서 실시간으로'):
 *    콘솔 금액(refreshed_at 까지의 사용, 보통 4시간쯤 늦다) + 그 뒤 앱이 센 만큼(ai_snap 의 refreshed_at 바로 앞 값과 지금의 차이)
 * 2) 없으면 앱 어림: 11월은 콘솔에서 본 $216.46 + 그 뒤 센 만큼, 그 뒤 달은 그 달 api_usage 합
 *    (앱 바깥(GitHub Actions 의 번역·정리·시험)에서 쓴 것은 api_usage 에 없어서 콘솔보다 조금 적게 나올 수 있다)
 */
export async function monthUsd(env: Env): Promise<{ month: string; usd: number; base: number | null; console: boolean; refreshedAt: number | null; limit: number }> {
  const month = new Date().toISOString().slice(0, 7);
  return { ...(await monthUsdOf(env, month)), limit: aiLimit(month) };
}

/** API 월 한도 (제작자 2026-11-13 '맥시멈 340' -> '이번 달은 300 한도'): 달마다 다르면 AI_LIMITS 에 그 달을 적는다, 없으면 340 */
const AI_LIMITS: Record<string, number> = { "2026-11": 300 };
export const aiLimit = (month: string) => AI_LIMITS[month] ?? 340;

/** 사람마다 AI 비용을 센 첫날 (api_usage, 한국 날짜). 그 전 질문은 질문 수로 어림한다 */
const TRACK_DAY = "2026-11-13";
/** 센 답이 너무 적을 때 쓰는 질문 하나의 값 (짐작) */
const GUESS_PER_Q = 0.2;

/**
 * 이번 달 이 사람(묶은 캐릭터 모두)이 쓴 AI 비용 (달러).
 * 센 것(api_usage) + 세기 전(2026-11-13 전) 챗봇 질문의 어림값 (제작자 2026-11-13 '추정해서 넣어야지'):
 * 세기 전 질문 수(chat_usage, 센 첫날은 그날 질문 수 - 그날 센 답 수) x 센 뒤 챗봇 답 하나의 평균 값.
 * 그 전 사진 읽기 등 다른 AI 는 질문에 딸린 것이 많아 따로 어림하지 않는다
 */
export async function personMonthUsd(env: Env, ids: string[], month = new Date().toISOString().slice(0, 7)): Promise<number> {
  const who = JSON.stringify(ids);
  const from = `${month}-01`;
  const counted = env.DB.prepare(`SELECT COALESCE(SUM(${USD_MICRO_SQL}), 0) AS m FROM api_usage WHERE user_id IN (SELECT value FROM json_each(?1)) AND day >= ?2`).bind(who, from);
  if (from > TRACK_DAY) {
    const row = await counted.first<{ m: number }>();
    return Number(row?.m ?? 0) / 1e6;
  }
  const [mine, avg, before, firstDay] = await env.DB.batch([
    counted,
    env.DB.prepare(`SELECT COALESCE(SUM(${USD_MICRO_SQL}), 0) AS m, COALESCE(SUM(calls), 0) AS c FROM api_usage WHERE kind = 'chat'`),
    env.DB.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM chat_usage WHERE user_id IN (SELECT value FROM json_each(?1)) AND day >= ?2 AND day < ?3").bind(who, from, TRACK_DAY),
    env.DB.prepare(
      "SELECT (SELECT COALESCE(SUM(count), 0) FROM chat_usage WHERE user_id IN (SELECT value FROM json_each(?1)) AND day = ?2) AS q, " +
        "(SELECT COALESCE(SUM(calls), 0) FROM api_usage WHERE user_id IN (SELECT value FROM json_each(?1)) AND day = ?2 AND kind = 'chat') AS c",
    ).bind(who, TRACK_DAY),
  ]);
  const one = <T,>(r: D1Result) => r.results[0] as T | undefined;
  const a = one<{ m: number; c: number }>(avg);
  const perQ = a && Number(a.c) >= 20 ? Number(a.m) / Number(a.c) / 1e6 : GUESS_PER_Q;
  const f = one<{ q: number; c: number }>(firstDay);
  const untracked = Number(one<{ n: number }>(before)?.n ?? 0) + Math.max(0, Number(f?.q ?? 0) - Number(f?.c ?? 0));
  return Number(one<{ m: number }>(mine)?.m ?? 0) / 1e6 + untracked * perQ;
}

async function monthUsdOf(env: Env, month: string): Promise<{ month: string; usd: number; base: number | null; console: boolean; refreshedAt: number | null }> {
  const official = await env.DB.prepare("SELECT usd, refreshed_at AS r FROM ai_cost WHERE month = ?")
    .bind(month)
    .first<{ usd: number; r: number | null }>()
    .catch(() => null);
  if (official && official.r) {
    const [all, snap] = await env.DB.batch([
      env.DB.prepare(`SELECT COALESCE(SUM(${USD_MICRO_SQL}), 0) AS m FROM api_usage`),
      env.DB.prepare("SELECT micro AS m FROM ai_snap WHERE at <= ? ORDER BY at DESC LIMIT 1").bind(official.r),
    ]);
    const a = Number((all.results[0] as { m: number } | undefined)?.m ?? 0);
    const s = (snap.results[0] as { m: number } | undefined)?.m;
    const after = s === undefined ? 0 : Math.max(0, a - Number(s)) / 1e6;
    return { month, usd: Number(official.usd) + after, base: null, console: true, refreshedAt: official.r };
  }
  if (month === AI_USD_BASE.month) {
    const [all, snap] = await env.DB.batch([
      env.DB.prepare(`SELECT COALESCE(SUM(${USD_MICRO_SQL}), 0) AS m FROM api_usage`),
      env.DB.prepare("SELECT done_at AS m FROM setup WHERE key = ?").bind(AI_USD_SNAP),
    ]);
    const a = Number((all.results[0] as { m: number } | undefined)?.m ?? 0);
    const s = (snap.results[0] as { m: number } | undefined)?.m;
    const after = s === undefined ? 0 : Math.max(0, a - Number(s)) / 1e6;
    return { month, usd: AI_USD_BASE.usd + after, base: AI_USD_BASE.usd, console: false, refreshedAt: null };
  }
  const row = await env.DB.prepare(`SELECT COALESCE(SUM(${USD_MICRO_SQL}), 0) AS m FROM api_usage WHERE day >= ?`).bind(`${month}-01`).first<{ m: number }>();
  return { month, usd: Number(row?.m ?? 0) / 1e6, base: null, console: false, refreshedAt: null };
}
