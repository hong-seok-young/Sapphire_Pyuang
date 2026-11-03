// POST /api/gd/remind -> 길드 던전 새 주 알림 (목요일 10:30, 제작자 2026-11-03 '목요일 10시반 알림도'). GitHub Actions gd-remind.yml 이 부른다.
//   로그인 없이 부를 수 있지만 서버가 주마다 한 번만, 주 시작 하루 안에서만 보내므로(server/gdungeon.ts remindWeek) 누가 눌러도 그 주의 알림이 한 번 가는 것뿐이다.
//   로컬(127.0.0.1)에서만 ?at=<때> 로 때를 바꿔 시험한다
import { json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { remindWeek } from "../../../server/gdungeon";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const at = local ? Number(url.searchParams.get("at")) : 0;
  const sent = await remindWeek(env, at > 0 ? at : Date.now());
  return json({ sent });
};
