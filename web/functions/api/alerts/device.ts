// PUT /api/alerts/device { state } -> 이 폰의 알림 허용 상태 (제작자 요청: 누가 폰(갤럭시) 설정에서 이 웹 알림을 켰는지 껐는지).
// 화면이 앱을 열 때 브라우저가 알려 주는 상태를 보낸다 (src/push.ts reportPush). '길드원 관리'에 보인다.
// on: 허용하고 폰 알림 켬 / app_off: 허용했지만 알림함에서 폰 알림 끔 / denied: 폰 설정에서 차단 / ask: 아직 안 물음 / none: 이 폰은 안 됨
// (사용 기록에 남지 않게 /api/alerts 아래에 둔다)
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";

const STATES = ["on", "app_off", "denied", "ask", "none"];

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const { state } = await readJson<{ state: unknown }>(request);
  if (typeof state !== "string" || !STATES.includes(state)) return json({ error: "상태가 맞지 않아요" }, 400);
  await env.DB.prepare("UPDATE users SET push_perm = ?, push_at = ? WHERE id = ?").bind(state, Date.now(), me.id).run();
  return json({ ok: true });
};
