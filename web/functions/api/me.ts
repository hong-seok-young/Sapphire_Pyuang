// GET /api/me -> 로그인한 사람 { id, role, mustChange, job, level, exp, avatar }. 로그인 안 했으면 401
// job, level 이 비어 있으면 화면이 처음 정하는 창을 띄운다 (길드 랭킹)
// 앱이 열릴 때마다 부르므로 여기서 로그인을 400일로 다시 늘린다 (로그아웃하기 전까지 로그인 유지)
import { NEED_LOGIN, currentUser, json, meInfo, renewSession } from "../../server/auth";
import type { Env } from "../../server/auth";
import { grantRentDonation } from "../../server/donate";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  // 장비대여에만 있는 기부자의 마일리지: 앱을 열면 한 번 (server/donate.ts, 답한 뒤에)
  waitUntil(grantRentDonation(env, me).catch((e) => console.error("rent donor grant", e instanceof Error ? e.message : e)));
  // 세션 늘리기와 내 정보를 한꺼번에 (앱을 열 때마다 부른다)
  const [renewed, info] = await Promise.all([renewSession(env, request), meInfo(env, me)]);
  return json(info, 200, renewed ? { "set-cookie": renewed } : {});
};
