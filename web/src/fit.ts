// 헬스 루틴 (개발중, 길드원 완뻔치 님 개발 요청 #8, 제작자 2026-11-09 '플릭 같은 헬스 어플'): 화면 src/pages/Fit.tsx, 서버 server/fit.ts.
// 기본 종목, 숫자 다루기, 지난번 값·최고 기록·1RM 셈은 여기서 한다 (서버는 저장만)
import { api, apiHeaders } from "./auth";

export type Part = "chest" | "back" | "legs" | "shoulder" | "arm" | "abs" | "cardio" | "etc";
export const PARTS: Part[] = ["chest", "back", "legs", "shoulder", "arm", "abs", "cardio", "etc"];
export const PART_NAME: Record<Part, string> = { chest: "가슴", back: "등", legs: "하체", shoulder: "어깨", arm: "팔", abs: "복근", cardio: "유산소", etc: "기타" };
/** weight: kg x 회, reps: 회만(맨몸), time: 초(플랭크), cardio: 분 · km */
export type Kind = "weight" | "reps" | "time" | "cardio";
export const KINDS: Kind[] = ["weight", "reps", "time", "cardio"];
export const KIND_NAME: Record<Kind, string> = { weight: "무게 · 회", reps: "회", time: "시간(초)", cardio: "분 · km" };

export interface Exercise {
  key: string;
  name: string;
  part: Part;
  kind: Kind;
  /** 내 종목이면 번호 */
  custom?: number;
}

/** 기본 종목 (키는 바꾸지 않는다: 기록이 키로 이어진다) */
const L = (key: string, name: string, part: Part, kind: Kind = "weight"): Exercise => ({ key, name, part, kind });
export const LIBRARY: Exercise[] = [
  L("bench", "벤치프레스", "chest"),
  L("incline_bench", "인클라인 벤치프레스", "chest"),
  L("db_bench", "덤벨 벤치프레스", "chest"),
  L("incline_db", "인클라인 덤벨프레스", "chest"),
  L("db_fly", "덤벨 플라이", "chest"),
  L("cable_cross", "케이블 크로스오버", "chest"),
  L("chest_press", "체스트 프레스 머신", "chest"),
  L("pec_deck", "펙덱 플라이", "chest"),
  L("pushup", "푸시업", "chest", "reps"),
  L("dips", "딥스", "chest", "reps"),
  L("deadlift", "데드리프트", "back"),
  L("lat_pulldown", "랫풀다운", "back"),
  L("barbell_row", "바벨로우", "back"),
  L("db_row", "덤벨로우", "back"),
  L("cable_row", "시티드 케이블 로우", "back"),
  L("tbar_row", "티바로우", "back"),
  L("pullup", "풀업", "back", "reps"),
  L("back_ext", "백 익스텐션", "back", "reps"),
  L("squat", "스쿼트", "legs"),
  L("leg_press", "레그프레스", "legs"),
  L("lunge", "런지", "legs"),
  L("bss", "불가리안 스플릿 스쿼트", "legs"),
  L("leg_ext", "레그 익스텐션", "legs"),
  L("leg_curl", "레그 컬", "legs"),
  L("rdl", "루마니안 데드리프트", "legs"),
  L("hip_thrust", "힙 쓰러스트", "legs"),
  L("calf_raise", "카프 레이즈", "legs"),
  L("ohp", "오버헤드프레스", "shoulder"),
  L("db_shoulder", "덤벨 숄더프레스", "shoulder"),
  L("lateral_raise", "사이드 레터럴 레이즈", "shoulder"),
  L("front_raise", "프론트 레이즈", "shoulder"),
  L("rear_delt", "리어 델트 플라이", "shoulder"),
  L("face_pull", "페이스 풀", "shoulder"),
  L("upright_row", "업라이트 로우", "shoulder"),
  L("barbell_curl", "바벨 컬", "arm"),
  L("db_curl", "덤벨컬", "arm"),
  L("hammer_curl", "해머 컬", "arm"),
  L("pushdown", "케이블 푸시다운", "arm"),
  L("skull_crusher", "라잉 트라이셉스 익스텐션", "arm"),
  L("oh_tricep", "오버헤드 트라이셉스 익스텐션", "arm"),
  L("crunch", "크런치", "abs", "reps"),
  L("leg_raise", "레그 레이즈", "abs", "reps"),
  L("hanging_raise", "행잉 레그 레이즈", "abs", "reps"),
  L("russian_twist", "러시안 트위스트", "abs", "reps"),
  L("cable_crunch", "케이블 크런치", "abs"),
  L("plank", "플랭크", "abs", "time"),
  L("treadmill", "러닝머신", "cardio", "cardio"),
  L("cycle", "실내 사이클", "cardio", "cardio"),
  L("stair", "천국의 계단", "cardio", "cardio"),
  L("rowing", "로잉머신", "cardio", "cardio"),
  L("elliptical", "일립티컬", "cardio", "cardio"),
  L("walk", "걷기", "cardio", "cardio"),
  L("jump_rope", "줄넘기", "cardio", "cardio"),
  L("burpee", "버피", "etc", "reps"),
  L("kb_swing", "케틀벨 스윙", "etc"),
  L("stretch", "스트레칭", "etc", "cardio"),
];

export interface FitSet {
  kg?: number;
  reps?: number;
  sec?: number;
  min?: number;
  km?: number;
  done?: boolean;
}
export interface Entry {
  key: string;
  name: string;
  part: Part;
  kind: Kind;
  sets: FitSet[];
  /** 루틴에 적어 둔 목표 (지난번 기록이 없을 때 칸의 흐린 값) */
  goal?: FitSet;
}
export interface RoutineItem {
  key: string;
  name: string;
  part: Part;
  kind: Kind;
  sets: number;
  goal: FitSet;
}
export interface Routine {
  id: number;
  name: string;
  items: RoutineItem[];
}
/** 하는 중인 운동 (draft) */
export interface Draft {
  title: string;
  started: number;
  routine?: number | null;
  entries: Entry[];
  memo?: string;
  /** 쉬는 시간 기본 (초) */
  restSec: number;
  /** 쉬는 중이면 끝나는 때와 처음 길이 */
  rest?: { end: number; total: number } | null;
  /** 마지막으로 고친 때 (이 기기와 서버 중 새 것을 고른다) */
  saved: number;
}
export interface Workout {
  id: number;
  day: string;
  started_at: number;
  ended_at: number;
  title: string;
  volume: number;
  sets: number;
  data: { title: string; started: number; ended: number; memo?: string; entries: Entry[] };
}
export interface FitData {
  custom: Exercise[];
  routines: Routine[];
  draft: Draft | null;
  /** 서버에 둔 draft 를 마지막으로 고친 때 */
  draftAt: number;
  workouts: Workout[];
}

const parse = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== "string") return (s as T) ?? fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export async function loadFit(): Promise<FitData> {
  const r = await api<{
    custom: { id: number; name: string; part: Part; kind: Kind }[];
    routines: { id: number; name: string; items: string }[];
    draft: { data: string; updated_at: number } | null;
    workouts: (Omit<Workout, "data"> & { data: string })[];
  }>("/api/fit");
  return {
    custom: r.custom.map((c) => ({ key: `c${c.id}`, name: c.name, part: c.part, kind: c.kind, custom: c.id })),
    routines: r.routines.map((x) => ({ id: x.id, name: x.name, items: parse<RoutineItem[]>(x.items, []) })),
    draft: r.draft ? parse<Draft | null>(r.draft.data, null) : null,
    draftAt: r.draft?.updated_at ?? 0,
    workouts: r.workouts.map((w) => ({ ...w, data: parse(w.data, { title: w.title, started: w.started_at, ended: w.ended_at, entries: [] }) })),
  };
}
export const addExercise = (b: { name: string; part: Part; kind: Kind }) => api<{ id: number; name: string; part: Part; kind: Kind }>("/api/fit/exercises", "POST", b);
export const delExercise = (id: number) => api<{ ok: true }>(`/api/fit/exercises/${id}`, "DELETE");
export const saveRoutine = (id: number | null, b: { name: string; items: RoutineItem[] }) =>
  api<{ id: number; name: string; items: string }>(id ? `/api/fit/routines/${id}` : "/api/fit/routines", id ? "PUT" : "POST", b);
export const delRoutine = (id: number) => api<{ ok: true }>(`/api/fit/routines/${id}`, "DELETE");
export const putDraft = (d: Draft) => api<{ ok: true; at: number }>("/api/fit/draft", "PUT", { data: d });
export const delDraft = () => api<{ ok: true }>("/api/fit/draft", "DELETE");
export const finishWorkout = (d: Draft) =>
  api<Omit<Workout, "data"> & { data: string }>("/api/fit/workouts", "POST", { data: { ...d, ended: Date.now() } }).then((w) => ({
    ...w,
    data: parse<Workout["data"]>(w.data, { title: w.title, started: w.started_at, ended: w.ended_at, entries: [] }),
  }));
export const delWorkout = (id: number) => api<{ ok: true }>(`/api/fit/workouts/${id}`, "DELETE");
/** 화면을 떠나거나 다른 앱으로 갈 때: 기다리지 않고 보낸다 (keepalive) */
export function beaconDraft(d: Draft) {
  try {
    void fetch("/api/fit/draft", { method: "PUT", credentials: "same-origin", headers: apiHeaders(true), body: JSON.stringify({ data: d }), keepalive: true }).catch(() => undefined);
  } catch {
    // 못 보내도 이 기기에는 있다
  }
}

// ---------- 이 기기에 둔 하는 중인 운동 (인터넷이 끊겨도 새로 고쳐도 이어서) ----------
const localKey = (user: string) => `sapphire.fit.draft.${user}`;
/** synced: 서버에 올라간 것인지 (서버에 없는데 올라갔던 것이면 다른 폰에서 끝냈거나 취소한 것) */
export function readLocal(user: string): { draft: Draft; synced: boolean } | null {
  try {
    const v = JSON.parse(localStorage.getItem(localKey(user)) ?? "null") as { draft: Draft; synced: boolean } | null;
    return v && v.draft && Array.isArray(v.draft.entries) ? v : null;
  } catch {
    return null;
  }
}
export function writeLocal(user: string, draft: Draft | null, synced = false) {
  try {
    if (draft) localStorage.setItem(localKey(user), JSON.stringify({ draft, synced }));
    else localStorage.removeItem(localKey(user));
  } catch {
    // 못 적어도 서버에는 간다
  }
}

// ---------- 숫자 ----------
const KST = 9 * 3_600_000;
export const kstDay = (ms: number) => new Date(ms + KST).toISOString().slice(0, 10);
/** 'YYYY-MM-DD' 의 요일 (월 0 ~ 일 6) */
export const weekdayMon = (day: string) => (new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7;
/** 그 날이 든 주의 월요일 'YYYY-MM-DD' (운동 기록은 실제 생활이라 월~일 주, 게임 리셋(목 10시)과 상관없다) */
export function mondayOf(day: string): string {
  const t = new Date(day + "T00:00:00Z").getTime() - weekdayMon(day) * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
export const addDays = (day: string, n: number) => new Date(new Date(day + "T00:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** 72.5 -> '72.5', 60 -> '60' */
export const numText = (n: number | undefined) => (n === undefined ? "" : String(Math.round(n * 100) / 100));
export const kgText = (n: number) => `${numText(n)}kg`;
/** 큰 볼륨은 '12,340kg' */
export const volText = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}kg`;
export const durText = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
};
export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
export const secText = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ""}` : `${s}초`);

/** 세트 하나를 짧게: '60×10', '12회', '45초', '30분 5km' */
export function setText(kind: Kind, s: FitSet): string {
  if (kind === "weight") return `${numText(s.kg ?? 0)}×${s.reps ?? 0}`;
  if (kind === "reps") return s.kg ? `+${numText(s.kg)}×${s.reps ?? 0}` : `${s.reps ?? 0}회`;
  if (kind === "time") return secText(s.sec ?? 0);
  return `${numText(s.min ?? 0)}분${s.km ? ` ${numText(s.km)}km` : ""}`;
}

/** 추정 1RM (Epley): 무게 x (1 + 회 / 30), 1회면 그 무게 */
export const e1rm = (kg: number, reps: number) => (reps <= 0 ? 0 : reps === 1 ? kg : kg * (1 + reps / 30));
/** 세트를 다 했는지 칸이 찼는지 */
export function setFilled(kind: Kind, s: FitSet): boolean {
  // 무게 종목은 무게도 적어야 (0kg 은 적으면 된다: 빈 봉, 머신 기본)
  if (kind === "weight") return (s.reps ?? 0) > 0 && s.kg !== undefined;
  if (kind === "reps") return (s.reps ?? 0) > 0;
  if (kind === "time") return (s.sec ?? 0) > 0;
  return (s.min ?? 0) > 0;
}

/** 운동 하나의 볼륨(kg x 회)과 끝낸 세트 수 */
export function draftTotals(entries: Entry[]): { volume: number; sets: number } {
  let volume = 0;
  let sets = 0;
  for (const e of entries)
    for (const s of e.sets)
      if (s.done) {
        sets++;
        volume += (s.kg ?? 0) * (s.reps ?? 0);
      }
  return { volume, sets };
}

/** 종목 하나의 하루 기록 (그래프 점 하나) */
export interface Point {
  id: number;
  day: string;
  at: number;
  sets: FitSet[];
  /** 그날 가장 무거운 무게 */
  top: number;
  /** 그날 가장 높은 추정 1RM */
  orm: number;
  /** 그날 볼륨 kg x 회 */
  vol: number;
  /** 그날 가장 많은 회 / 가장 긴 초 / 가장 긴 km / 가장 긴 분 */
  reps: number;
  totalReps: number;
  sec: number;
  km: number;
  min: number;
}
export function pointOf(w: { id: number; day: string; started_at: number }, e: Entry): Point {
  const p: Point = { id: w.id, day: w.day, at: w.started_at, sets: e.sets, top: 0, orm: 0, vol: 0, reps: 0, totalReps: 0, sec: 0, km: 0, min: 0 };
  for (const s of e.sets) {
    const kg = s.kg ?? 0;
    const r = s.reps ?? 0;
    p.top = Math.max(p.top, kg);
    p.orm = Math.max(p.orm, e1rm(kg, r));
    p.vol += kg * r;
    p.reps = Math.max(p.reps, r);
    p.totalReps += r;
    p.sec = Math.max(p.sec, s.sec ?? 0);
    p.km += s.km ?? 0;
    p.min += s.min ?? 0;
  }
  return p;
}
/** 종목마다 기록 (오래된 것부터) */
export function historyByKey(workouts: Workout[]): Map<string, Point[]> {
  const m = new Map<string, Point[]>();
  for (let i = workouts.length - 1; i >= 0; i--) {
    const w = workouts[i];
    for (const e of w.data.entries ?? []) {
      const list = m.get(e.key) ?? [];
      list.push(pointOf(w, e));
      m.set(e.key, list);
    }
  }
  for (const list of m.values()) list.sort((a, b) => a.at - b.at);
  return m;
}

/** 종목의 가장 좋은 값 하나 (종류마다): 최고 기록 비교와 목록 오른쪽 글 */
export function bestOf(kind: Kind, p: Point): number {
  if (kind === "weight") return p.orm;
  if (kind === "reps") return p.reps;
  if (kind === "time") return p.sec;
  return p.km || p.min;
}
export function bestText(kind: Kind, list: Point[]): string {
  if (!list.length) return "";
  if (kind === "weight") return `최고 ${kgText(Math.max(...list.map((p) => p.top)))}`;
  if (kind === "reps") return `최고 ${Math.max(...list.map((p) => p.reps))}회`;
  if (kind === "time") return `최고 ${secText(Math.max(...list.map((p) => p.sec)))}`;
  const km = Math.max(...list.map((p) => p.km));
  return km ? `최장 ${numText(km)}km` : `최장 ${numText(Math.max(...list.map((p) => p.min)))}분`;
}

/** 이번 운동에서 새로 세운 최고 기록 (전에 한 번이라도 한 종목만: 처음 한 종목까지 다 최고라고 하지 않는다) */
export interface PR {
  name: string;
  text: string;
}
export function newRecords(entries: Entry[], before: Map<string, Point[]>): PR[] {
  const out: PR[] = [];
  for (const e of entries) {
    const done = e.sets.filter((s) => s.done);
    if (!done.length) continue;
    const old = before.get(e.key);
    if (!old?.length) continue;
    const now = pointOf({ id: 0, day: "", started_at: 0 }, { ...e, sets: done });
    if (e.kind === "weight") {
      const top = Math.max(...old.map((p) => p.top));
      const orm = Math.max(...old.map((p) => p.orm));
      if (now.top > top) out.push({ name: e.name, text: `최고 무게 ${kgText(now.top)}` });
      else if (now.orm > orm + 0.01) out.push({ name: e.name, text: `추정 1RM ${kgText(Math.round(now.orm * 10) / 10)}` });
    } else if (e.kind === "reps") {
      if (now.reps > Math.max(...old.map((p) => p.reps))) out.push({ name: e.name, text: `최고 ${now.reps}회` });
    } else if (e.kind === "time") {
      if (now.sec > Math.max(...old.map((p) => p.sec))) out.push({ name: e.name, text: `최고 ${secText(now.sec)}` });
    } else if (now.km > Math.max(...old.map((p) => p.km))) out.push({ name: e.name, text: `최장 ${numText(now.km)}km` });
    else if (!now.km && now.min > Math.max(...old.map((p) => p.min))) out.push({ name: e.name, text: `최장 ${numText(now.min)}분` });
  }
  return out;
}

/** 연속 운동한 주 수 (이번 주에 아직 안 했으면 지난주부터 센다) */
export function weekStreak(days: Set<string>, today: string): number {
  const weeks = new Set([...days].map(mondayOf));
  let w = mondayOf(today);
  if (!weeks.has(w)) w = addDays(w, -7);
  let n = 0;
  while (weeks.has(w)) {
    n++;
    w = addDays(w, -7);
  }
  return n;
}
