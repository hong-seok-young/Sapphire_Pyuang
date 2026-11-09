// PUT /api/profile { job, level, exp?, guild? } -> 내 직업, 레벨, 경험치 %, 길드(1군 main / 2군 second) (처음 정하는 창과 '내 정보'에서)
// exp 는 경험치 % x 1000 (12.345% -> 12345). 비우면 null, 안 보내면(예전 화면) 그대로 둔다
import { NEED_LOGIN, currentUser, json, readChange, readJson, readProfile, saveProfile } from "../../server/auth";
import type { Env } from "../../server/auth";
import { LEVEL_COINS, coinGain, walletBefore } from "../../server/gcoin";
import { raceAfter, raceBefore } from "../../server/gcrace";

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const body = await readJson<{ job: unknown; level: unknown; exp: unknown; guild: unknown; change: unknown }>(request);
  const p = readProfile(body);
  if (!p) return json({ error: "길드와 직업을 고르고 레벨을 1~99, 경험치를 0~99.999% 로 넣어 주세요" }, 400);
  // 2군 성장코인샵: 2군 본캐가 레벨·경험치를 적으면 그만큼 성장코인 (server/gcoin.ts). 새로 생긴 코인을 같이 돌려주면 화면이 동전 팝업을 띄운다
  // 지금은 시범운영이라 레벨 코인 대신 2주 목표 선착순 (server/gcrace.ts): 달성률이 오르거나 목표를 찍으면 화면이 팝업을 띄운다
  const before = LEVEL_COINS ? await walletBefore(env, me) : null;
  const raceB = await raceBefore(env, me);
  // change: 'grow' 실제 성장 / 'fix' 잘못 쓴 것 고침 (화면이 묻는다)
  await saveProfile(env, me.id, me.id, p, readChange(body.change));
  const coin = before ? await coinGain(env, me, before) : null;
  const race = raceB ? await raceAfter(env, me, raceB) : null;
  return json({ ...p, ...(coin ? { coin } : {}), ...(race ? { race } : {}) });
};
