// 헬스 루틴 (개발중, 길드원 완뻔치 님 개발 요청 #8 '헬스루틴 추가해주세요', 제작자 2026-11-09 '플릭 같은 헬스 어플 만들어 달라는 거'):
// 실제 헬스장 운동을 적는 기록장. 게임과 상관없다. 화면 src/pages/Fit.tsx, src/fit.ts, API functions/api/fit.
// - 캐릭터마다 자기 것만 읽고 쓴다 (남의 기록은 아무도 못 본다).
// - 표: fit_exercises(내 종목), fit_routines(루틴, 종목 목록 JSON), fit_workouts(끝낸 운동 하나에 한 줄, 세트 JSON), fit_drafts(하는 중인 운동, 사람마다 한 줄).
// - 서버는 모양만 맞추고 저장한다 (CPU 를 아끼려고 그래프·최고 기록은 화면이 셈한다). 기록은 저절로 지우지 않는다 (사람이 지우는 것만)
import type { User } from "./auth";
import { TEST_IDS } from "./auth";

/** 길드원에게 열기 전에는 앱개발자(와 테스트 계정)만 (제작자 2026-11-09 '일단 나만 보이게 해줘'. 화면 src/launcher.ts 의 canFit, App.tsx 도 같이) */
export const FIT_OPEN = false;
export const canUseFit = (me: User) => FIT_OPEN || me.role === "developer" || TEST_IDS.includes(me.id);

export const PARTS = ["chest", "back", "legs", "shoulder", "arm", "abs", "cardio", "etc"] as const;
export type Part = (typeof PARTS)[number];
/** weight: kg x 회, reps: 회만(맨몸), time: 초(플랭크), cardio: 분 · km */
export const KINDS = ["weight", "reps", "time", "cardio"] as const;
export type Kind = (typeof KINDS)[number];

export const MAX_CUSTOM = 100;
export const MAX_ROUTINES = 30;
export const MAX_ITEMS = 25;
export const MAX_SETS = 30;
export const MAX_ENTRIES = 40;
export const MAX_NAME = 30;
/** 하는 중인 운동 JSON 한도 (글자 수) */
export const MAX_DRAFT = 60_000;

const isPart = (v: unknown): v is Part => typeof v === "string" && (PARTS as readonly string[]).includes(v);
const isKind = (v: unknown): v is Kind => typeof v === "string" && (KINDS as readonly string[]).includes(v);

export const readName = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t && t.length <= MAX_NAME ? t : null;
};
const readKey = (v: unknown): string | null => (typeof v === "string" && /^[a-z0-9_]{1,30}$/.test(v) ? v : null);

/** 숫자 칸: 범위 밖이나 숫자가 아니면 없음, 소수는 자리수만큼 */
function n(v: unknown, max: number, digits = 0): number | undefined {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(x) || x < 0 || x > max) return undefined;
  const p = 10 ** digits;
  return Math.round(x * p) / p;
}

export interface SetIn {
  kg?: number;
  reps?: number;
  sec?: number;
  min?: number;
  km?: number;
  done?: boolean;
}
function readSet(v: unknown): SetIn {
  const s = (v ?? {}) as Record<string, unknown>;
  const out: SetIn = {};
  const kg = n(s.kg, 1000, 2);
  const reps = n(s.reps, 1000);
  const sec = n(s.sec, 36_000);
  const min = n(s.min, 1440, 1);
  const km = n(s.km, 500, 2);
  if (kg !== undefined) out.kg = kg;
  if (reps !== undefined) out.reps = reps;
  if (sec !== undefined) out.sec = sec;
  if (min !== undefined) out.min = min;
  if (km !== undefined) out.km = km;
  if (s.done === true) out.done = true;
  return out;
}

/** 내 종목 { name, part, kind } */
export function readExercise(b: { name?: unknown; part?: unknown; kind?: unknown }): { name: string; part: Part; kind: Kind } | string {
  const name = readName(b.name);
  if (!name) return `종목 이름을 ${MAX_NAME}자 안으로 적어 주세요`;
  if (!isPart(b.part)) return "부위를 골라 주세요";
  if (!isKind(b.kind)) return "기록 방법을 골라 주세요";
  return { name, part: b.part, kind: b.kind };
}

interface Item {
  key: string;
  name: string;
  part: Part;
  kind: Kind;
  sets: number;
  goal: SetIn;
}
/** 루틴 { name, items: [{ key, name, part, kind, sets, goal }] } */
export function readRoutine(b: { name?: unknown; items?: unknown }): { name: string; items: Item[] } | string {
  const name = readName(b.name);
  if (!name) return `루틴 이름을 ${MAX_NAME}자 안으로 적어 주세요`;
  if (!Array.isArray(b.items) || !b.items.length) return "종목을 하나 이상 넣어 주세요";
  if (b.items.length > MAX_ITEMS) return `종목은 ${MAX_ITEMS}개까지예요`;
  const items: Item[] = [];
  for (const raw of b.items) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const key = readKey(it.key);
    const nm = readName(it.name);
    if (!key || !nm || !isPart(it.part) || !isKind(it.kind)) return "종목 모양이 맞지 않아요";
    const sets = Math.min(MAX_SETS, Math.max(1, Math.round(Number(it.sets) || 1)));
    const goal = readSet(it.goal);
    delete goal.done;
    items.push({ key, name: nm, part: it.part, kind: it.kind, sets, goal });
  }
  return { name, items };
}

export interface Entry {
  key: string;
  name: string;
  part: Part;
  kind: Kind;
  sets: SetIn[];
}
export interface WorkoutIn {
  title: string;
  started: number;
  ended: number;
  memo?: string;
  entries: Entry[];
}

const KST = 9 * 3_600_000;
/** 한국 날짜 'YYYY-MM-DD' */
export const kstDay = (ms: number) => new Date(ms + KST).toISOString().slice(0, 10);

/**
 * 끝낸 운동: 끝낸 세트(done)만 남기고, 끝낸 세트가 없는 종목은 뺀다. 볼륨(kg x 회)과 세트 수를 같이 셈한다.
 * 시작은 2일 전 ~ 지금, 끝은 시작 ~ 시작 + 12시간 (지금보다 늦으면 지금)
 */
export function readWorkout(v: unknown, now: number): { w: WorkoutIn; volume: number; sets: number } | string {
  const d = (v ?? {}) as Record<string, unknown>;
  const started = Number(d.started);
  if (!Number.isFinite(started) || started > now + 60_000 || started < now - 2 * 86_400_000) return "운동 시작 시각이 맞지 않아요";
  let ended = Number(d.ended);
  if (!Number.isFinite(ended) || ended < started) ended = now;
  ended = Math.min(ended, now, started + 12 * 3_600_000);
  if (!Array.isArray(d.entries)) return "종목이 없어요";
  const entries: Entry[] = [];
  let volume = 0;
  let sets = 0;
  for (const raw of d.entries.slice(0, MAX_ENTRIES)) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const key = readKey(e.key);
    const name = readName(e.name);
    if (!key || !name || !isPart(e.part) || !isKind(e.kind) || !Array.isArray(e.sets)) continue;
    const done = e.sets
      .slice(0, MAX_SETS)
      .map(readSet)
      .filter((s) => s.done)
      .map((s) => {
        const c: SetIn = {};
        if (e.kind === "weight") Object.assign(c, { kg: s.kg ?? 0, reps: s.reps ?? 0 });
        else if (e.kind === "reps") Object.assign(c, { reps: s.reps ?? 0 }, s.kg ? { kg: s.kg } : {});
        else if (e.kind === "time") c.sec = s.sec ?? 0;
        else Object.assign(c, { min: s.min ?? 0 }, s.km !== undefined ? { km: s.km } : {});
        return c;
      });
    if (!done.length) continue;
    for (const s of done) volume += (s.kg ?? 0) * (s.reps ?? 0);
    sets += done.length;
    entries.push({ key, name, part: e.part, kind: e.kind, sets: done });
  }
  if (!entries.length) return "끝낸 세트가 없어요. 세트 오른쪽 칸을 눌러 체크해 주세요";
  const title = readName(d.title) ?? "운동";
  const memo = typeof d.memo === "string" ? d.memo.trim().slice(0, 300) : "";
  return { w: { title, started, ended, ...(memo ? { memo } : {}), entries }, volume: Math.round(volume * 100) / 100, sets };
}
