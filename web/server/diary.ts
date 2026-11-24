// 비공개 일지 (#/diary, 화면 pages/Diary.tsx, API functions/api/diary). 보는 사람은 Pages 비밀값 DIARY_VIEWERS(쉼표로 이은 닉네임, 묶은 캐릭터 중 하나라도)에 든 사람만.
// 누구인지는 공개 저장소에 적지 않는다 (배포가 비공개 자료에서 넣는다, deploy-web.yml). 비밀값이 없으면 아무도 못 본다.
// 다른 사람에게는 칸도 화면도 없고 API 는 404 (있는지도 모르게). 사용 기록·누른 단추·알림·챗봇·패치 내역 어디에도 남기지 않는다.
import type { Env, User } from "./auth";

export const canUseDiary = (env: Env, me: User) => {
  const list = (env.DIARY_VIEWERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 && (me.chars ?? [me.id]).some((c) => list.includes(c));
};

/** 칸·화면에 보일 이름 (이름도 공개 저장소에 적지 않는다) */
export const diaryTitle = (env: Env) => (env.DIARY_TITLE ?? "").trim().slice(0, 20) || "일지";

export interface DiaryEntry {
  id: number;
  author: string;
  day: string;
  time: string;
  place: string;
  lv_from: number | null;
  exp_from: number | null;
  lv_to: number | null;
  exp_to: number | null;
  gold: number | null;
  items: string;
  note: string;
  created_at: number;
  updated_at: number;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, lo: number, hi: number) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
};

/** 화면이 보낸 일지 한 줄을 맞춘다 (틀리면 까닭 글) */
export function readEntry(b: Record<string, unknown>): Omit<DiaryEntry, "id" | "author" | "created_at" | "updated_at"> | string {
  const day = str(b.day, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "날짜가 맞지 않아요";
  const lv_from = num(b.lv_from, 1, 99);
  const lv_to = num(b.lv_to, 1, 99);
  const exp_from = num(b.exp_from, 0, 100);
  const exp_to = num(b.exp_to, 0, 100);
  const gold = num(b.gold, -1e9, 1e9);
  if ([lv_from, lv_to, exp_from, exp_to, gold].includes(undefined)) return "숫자가 맞지 않아요";
  const e = {
    day,
    time: str(b.time, 30),
    place: str(b.place, 60),
    lv_from: lv_from as number | null,
    exp_from: exp_from as number | null,
    lv_to: lv_to as number | null,
    exp_to: exp_to as number | null,
    gold: gold as number | null,
    items: str(b.items, 500),
    note: str(b.note, 2000),
  };
  if (!e.time && !e.place && e.lv_to === null && e.gold === null && !e.items && !e.note) return "적은 것이 없어요";
  return e;
}
