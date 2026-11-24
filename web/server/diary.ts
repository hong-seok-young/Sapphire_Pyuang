// 비공개 일지 (#/diary, 화면 pages/Diary.tsx, API functions/api/diary). 보는 사람은 Pages 비밀값 DIARY_VIEWERS(쉼표로 이은 닉네임, 묶은 캐릭터 중 하나라도)에 든 사람만.
// 누구인지와 이름(DIARY_TITLE)은 공개 저장소에 적지 않는다 (배포가 비공개 자료에서 넣는다, deploy-web.yml). 비밀값이 없으면 아무도 못 본다.
// 다른 사람에게는 칸도 화면도 없고 API 는 404 (있는지도 모르게). 사용 기록·누른 단추·알림·챗봇·AI 사용량·패치 내역 어디에도 남기지 않는다.
//
// 기록 한 줄 = 스샷 두 장(시작·끝)과 거기서 읽은 레벨·경험치 %·게임 시각 (diary_runs, diary_shots). 오른 % 에 레벨마다 1% 단가(diary_rates)를 곱한 것이 그 줄의 금액.
// 단가는 1%당 원으로 적거나, 1시간 금액과 1시간 시험에서 오른 % 로 적으면 1%당 = 1시간 금액 / 시험 % (화면이 같은 셈, src/pages/Diary.tsx).
// 정산(diary_settles): 아직 정산 안 한 줄을 모두 더하고 지난 이월을 더해 1000원 아래는 버리고(다음 정산으로 이월) 그 금액을 적는다. 정산한 줄은 그때 금액(won)으로 굳는다.
import type { Env, User } from "./auth";

export const canUseDiary = (env: Env, me: User) => {
  const list = (env.DIARY_VIEWERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 && (me.chars ?? [me.id]).some((c) => list.includes(c));
};

/** 칸·화면에 보일 이름 (이름도 공개 저장소에 적지 않는다) */
export const diaryTitle = (env: Env) => (env.DIARY_TITLE ?? "").trim().slice(0, 20) || "일지";

/** 다른 사람에게는 없는 주소처럼 */
export const NOPE = () => new Response("Not found", { status: 404 });

export interface Rate {
  level: number;
  per_pct: number | null;
  per_hour: number | null;
  test_pct: number | null;
}
export interface Run {
  id: number;
  lv_from: number;
  exp_from: number;
  lv_to: number;
  exp_to: number;
}

/** 그 레벨의 1%당 원 (모르면 null) */
export function perPct(rates: Rate[], level: number): number | null {
  const r = rates.find((x) => x.level === level);
  if (!r) return null;
  if (r.per_pct !== null && r.per_pct > 0) return r.per_pct;
  if (r.per_hour !== null && r.per_hour > 0 && r.test_pct !== null && r.test_pct > 0) return r.per_hour / r.test_pct;
  return null;
}

/** 레벨마다 오른 % (레벨이 오른 줄은 레벨마다 나눈다) */
export function gains(run: Run): { level: number; pct: number }[] {
  const out: { level: number; pct: number }[] = [];
  for (let lv = run.lv_from; lv <= run.lv_to; lv++) {
    const from = lv === run.lv_from ? run.exp_from : 0;
    const to = lv === run.lv_to ? run.exp_to : 100;
    out.push({ level: lv, pct: to - from });
  }
  return out;
}

/** 그 줄의 금액 (단가를 모르는 레벨이 있으면 null) */
export function valueOf(run: Run, rates: Rate[]): number | null {
  let won = 0;
  for (const g of gains(run)) {
    if (g.pct === 0) continue;
    const p = perPct(rates, g.level);
    if (p === null) return null;
    won += g.pct * p;
  }
  return won;
}

export const UNIT = 1000;

const num = (v: unknown, lo: number, hi: number) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
};
const clock = (v: unknown) => (typeof v === "string" && /^\d{1,2}:\d{2}(:\d{2})?$/.test(v.trim()) ? v.trim() : "");

/** 화면이 보낸 기록 한 줄을 맞춘다 (틀리면 까닭 글) */
export function readRun(b: Record<string, unknown>) {
  const day = typeof b.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.day) ? b.day : null;
  const lv_from = num(b.lv_from, 1, 99);
  const lv_to = num(b.lv_to, 1, 99);
  const exp_from = num(b.exp_from, 0, 100);
  const exp_to = num(b.exp_to, 0, 100);
  if (!day) return "날짜가 맞지 않아요";
  if (lv_from == null || lv_to == null || exp_from == null || exp_to == null) return "레벨과 경험치를 적어 주세요";
  if (!Number.isInteger(lv_from) || !Number.isInteger(lv_to)) return "레벨은 정수예요";
  if (lv_to < lv_from || lv_to - lv_from > 5) return "끝 레벨이 맞지 않아요";
  return { day, lv_from, exp_from, lv_to, exp_to, t_from: clock(b.t_from), t_to: clock(b.t_to) };
}

export async function readRates(env: Env): Promise<Rate[]> {
  const { results } = await env.DB.prepare("SELECT level, per_pct, per_hour, test_pct FROM diary_rates ORDER BY level").all<Rate>();
  return results;
}
