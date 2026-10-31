// GET /api/growth?period=day|week|month -> 성장 랭킹 (로그인한 길드원 누구나).
// 계산은 server/growth.ts (챗봇도 같이 쓴다). 오른 사람만 많이 오른 순.
// 경험치 값 자체는 주지 않고 오른 양(growth, % x 1000)만 준다.
import { NEED_LOGIN, currentUser, json } from "../../server/auth";
import type { Env } from "../../server/auth";
import { PERIODS, growthEntries } from "../../server/growth";
import type { Period } from "../../server/growth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const period = new URL(request.url).searchParams.get("period") ?? "week";
  if (!(PERIODS as readonly string[]).includes(period)) return json({ error: "기간은 day, week, month 예요" }, 400);
  const { start, entries } = await growthEntries(env, period as Period);
  return json({ period, start, entries });
};
