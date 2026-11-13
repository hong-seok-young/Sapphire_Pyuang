// GET /api/chat/usage -> 챗봇 입력창 위 한 줄 막대 (제작자 2026-11-13 '300 중 내가 얼마 썼냐 길드 전체 얼마 썼냐, 막대 행 하나에', 초안 B):
// 이번 달 길드 전체 AI 비용(사용 기록의 '11월 누적'과 같은 값), 내 몫(묶은 캐릭터 모두), 월 한도. 로그인한 길드원 누구나
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { monthUsd, personMonthUsd } from "../../../server/apiUsage";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const [guild, mine] = await Promise.all([monthUsd(env), personMonthUsd(env, me.chars ?? [me.id]).catch(() => 0)]);
  return json({ month: guild.month, limit: guild.limit, guild: guild.usd, me: Math.min(mine, guild.usd) });
};
