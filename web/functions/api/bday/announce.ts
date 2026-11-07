// POST /api/bday/announce -> 생일 알림 (제작자 2026-11-07 '11월 8일 되는 순간 바로 전원에게 알림'). GitHub Actions bday-notice.yml 이 0시에 여러 번 부른다.
//   로그인 없이 부를 수 있지만 그날 안에서만, 알림은 한 번, 폰 알림은 40대씩 한 번씩만 보내므로(server/birthday.ts announceBday) 누가 불러도 더 가는 것은 없다.
//   로컬(127.0.0.1)에서만 ?at=<때> 로 때를 바꿔 시험한다
import { json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { announceBday } from "../../../server/birthday";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const at = local ? Number(url.searchParams.get("at")) : 0;
  return json({ sent: await announceBday(env, at > 0 ? at : Date.now()) });
};
