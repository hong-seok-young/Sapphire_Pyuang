// 도감 계산기 완료 체크 백업 안내 (제작자 2026-11-19 '섬예님이 어디든 접속하면 안내 뜨게, 알림도 하나')
// 서버 저장(dex_done) 전에 PC 브라우저에만 체크해 둔 사람. 그 PC 로 사이트를 열면 화면이 저절로 올리고(src/pages/DexBackup.tsx),
// 다른 기기에서는 '체크해 둔 PC로 한 번만 열어 주세요' 안내가 뜬다. 서버에 줄이 생기면 더 묻지 않는다.
import type { Env } from "./auth";

export const DEX_BACKUP_ASK = ["섬예"];

/** 이 사람(묶은 캐릭터 아이디들)이 백업을 기다리는지. 명단에 없으면 DB 를 읽지 않는다 */
export async function dexBackupAsk(env: Env, ids: string[]): Promise<boolean> {
  if (!ids.some((id) => DEX_BACKUP_ASK.includes(id))) return false;
  const row = await env.DB.prepare(
    "SELECT 1 AS x FROM dex_done WHERE user_id IN (SELECT value FROM json_each(?)) AND n > 0 LIMIT 1",
  )
    .bind(JSON.stringify(ids))
    .first();
  return !row;
}
