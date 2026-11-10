// GET /api/bday/live?key=village-2026 (WebSocket): 생일 콤보 실시간 (server/bdayLive.ts). 로그인을 보고 그 사람 아이디를 붙여 Durable Object 로 넘긴다.
// 일꾼이 없으면(배포 전) 501, 화면은 몇 번 다시 해 보고 그만둔다. 테스트 계정은 보기만 (누른 것을 퍼뜨리지 않는다)
import { NEED_LOGIN, TEST_IDS, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { BDAYS } from "../../../server/birthday";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!env.BDAYLIVE) return json({ error: "준비 중이에요" }, 501);
  if (request.headers.get("Upgrade") !== "websocket") return json({ error: "websocket 으로만" }, 426);
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const d = BDAYS[key];
  if (!d || Date.now() >= d.end + 3600_000) return json({ error: "없는 생일이에요" }, 404);
  const u = new URL("https://bday-live/live");
  u.searchParams.set("user", TEST_IDS.includes(me.id) ? "" : me.id);
  return env.BDAYLIVE.get(env.BDAYLIVE.idFromName(key)).fetch(new Request(u, request));
};
