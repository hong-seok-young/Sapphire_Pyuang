// D1 하루 읽기 아끼기 (2026-11-14 제작자 '무료 한도 내에서 무조건 해결되게'): 하루 읽기 한도(500만 줄, 0시 UTC 에 초기화)를 넘으면
// 그날 9시(한국)까지 모든 요청이 막힌다. GitHub Actions `.github/workflows/d1-guard.yml`(15분마다, scripts/d1-guard.mjs)이 그날 읽은 줄을 재서
// setup 'read_saver_<UTC 날짜>' (계정 DB 쪽 계정) · 'log_saver_<UTC 날짜>' (사용 기록 쪽 계정) 에 단계(0 · 1 · 2)를 적는다.
//   1 (60% 넘음): 사용 기록 화면과 챗봇의 사용 기록 자료를 쉰다
//   2 (80% 넘음): 그에 더해 새 글 배지의 글·물건 따라가기(things), 챗봇의 자료 저장소 찾기, 아이모 소식 글자 찾기를 쉰다
// 로그인·정보·게시판·챗봇 답처럼 꼭 필요한 것은 그대로 둔다. 한 일꾼에서 1분에 한 번만 읽는다 (읽기 2줄).
import type { Env } from "./auth";

export type Saver = { main: number; log: number };

let memo: { day: string; at: number; v: Saver } | null = null;

export async function saver(env: Env): Promise<Saver> {
  const day = new Date().toISOString().slice(0, 10);
  if (memo && memo.day === day && Date.now() - memo.at < 60_000) return memo.v;
  let v: Saver = { main: 0, log: 0 };
  try {
    const rows = (
      await env.DB.prepare("SELECT key, done_at FROM setup WHERE key IN (?1, ?2)").bind(`read_saver_${day}`, `log_saver_${day}`).all<{ key: string; done_at: number }>()
    ).results;
    for (const r of rows) {
      if (r.key.startsWith("read_")) v.main = Number(r.done_at) || 0;
      else v.log = Number(r.done_at) || 0;
    }
  } catch {
    v = memo?.v ?? v;
  }
  memo = { day, at: Date.now(), v };
  return v;
}

/** 사용 기록(기록 DB 를 크게 읽는 것)을 쉬는지 */
export async function logResting(env: Env): Promise<boolean> {
  const s = await saver(env);
  return s.main >= 1 || s.log >= 1;
}

/** 꼭 필요하지 않은 무거운 읽기를 쉬는지 */
export async function heavyResting(env: Env): Promise<boolean> {
  return (await saver(env)).main >= 2;
}

export const RESTING_TEXT = "오늘 DB 무료 사용량을 아끼는 중이라 잠시 쉬어요. 오전 9시에 다시 열려요";
