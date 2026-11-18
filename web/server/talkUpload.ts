// 톡방 올리기 (제작자 2026-11-18): 카톡 '대화 내보내기 → 공유'에서 Sapphire 웹앱을 고르거나 파일을 골라 올리면 D1 에 잠깐 두고,
// 자료 저장소(sapphire-imo-data)의 Actions(talk-import.yml, scripts/talk_import.mjs) 가 한 시간에 한 번 (비밀값 없이 GitHub OIDC, api/talk-upload/pending.ts) 자료 저장소 카톡/ 에 새 날짜 것만 더해 올린다. 화면 src/pages/TalkUpload.tsx, 표 schema.sql talk_uploads·talk_parts
import { RANK } from "./auth";
import type { Env, User } from "./auth";
import { notify } from "./alerts";
import { weekStart } from "./week";

/** 올리는 사람: 앱개발자·길드마스터 (톡방 대화는 비공개 자료라서) */
export const canUploadTalk = (me: User) => RANK[me.role] >= 2;
/** gzip 한 글 한 파일 (내보낸 글 수십 MB 까지) */
export const TALK_MAX_GZ = 12_000_000;
export const PART = 1_500_000;

/** 매주 한 번 '톡방 내보내기 할 때예요' (GitHub Actions talk-remind.yml 이 부른다, 주마다 한 번만) */
export async function remindTalk(env: Env, now = Date.now()): Promise<number> {
  const key = `talk_remind_${weekStart(now)}`;
  const put = await env.DB.prepare("INSERT INTO setup (key, done_at) VALUES (?, ?) ON CONFLICT (key) DO NOTHING").bind(key, now).run();
  if (!put.meta.changes) return 0;
  const { results } = await env.DB.prepare("SELECT id FROM users WHERE role = 'developer' AND main_id IS NULL").all<{ id: string }>();
  const to = results.map((r) => r.id);
  await notify(env, to, "talk_up", "톡방 내보내기 할 때예요 · 카톡 방 ≡ → 설정 → 대화 내보내기 → 텍스트만 → 공유 → Sapphire", "#/talk", "Sapphire");
  return to.length;
}
