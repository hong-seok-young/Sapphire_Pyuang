// POST /api/talk-upload/remind -> 이번 주 '톡방 내보내기 할 때예요' 알림 (GitHub Actions talk-remind.yml, 주마다 한 번만이라 비밀값 없이 부른다)
import { json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { remindTalk } from "../../../server/talkUpload";

export const onRequestPost: PagesFunction<Env> = async ({ env }) => json({ sent: await remindTalk(env) });
