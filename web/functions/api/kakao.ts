// 카톡 오픈프로필 링크 (제작자 요청 2026-11-02: 대화를 카톡 오픈프로필로 바로 그 사람 카톡이 켜지게. 앱 안 대화는 그대로 두고 단추를 같이 단다).
// 카카오는 일반 카톡 1:1 대화창을 여는 공개 링크가 없어서, 각자 만든 오픈프로필(또는 1:1 오픈채팅) 링크를 적어 두고 이름 옆 '카톡' 단추로 연다.
// GET /api/kakao -> { links: { 닉네임: 링크 }, staff: [링크가 있는 장비대여 담당(멍멍) 닉네임], high: [고스펙 닉네임] } (로그인한 길드원. 부캐는 자기 것이 없으면 본캐 것)
//   high: 닉네임이 뜨는 곳마다 고스펙 반짝임을 그리려고 (제작자 요청 2026-11-02 '고스펙 닉네임 애니메이션은 어디서든', src/kakao.tsx Nick)
// PUT /api/kakao { link, user? } -> 내 링크 (user 를 주면 그 사람 것: 길드원 관리를 할 수 있는 사람만). 빈 글이면 지운다
import { FORBIDDEN, NEED_LOGIN, RANK, TEST_IDS, canManageUser, currentUser, json, readJson, samePerson } from "../../server/auth";
import type { Env, Role } from "../../server/auth";
import { RENT_STAFF } from "../../server/rental";

/** open.kakao.com 의 오픈프로필(/me/…)·오픈채팅(/o/…) 링크만 받는다 */
export function readKakao(v: unknown): string | null | "bad" {
  if (v === null || v === undefined || (typeof v === "string" && !v.trim())) return null;
  if (typeof v !== "string") return "bad";
  const m = v.trim().match(/^(?:https?:\/\/)?open\.kakao\.com\/(o|me)\/([A-Za-z0-9_-]{4,40})\/?$/);
  return m ? `https://open.kakao.com/${m[1]}/${m[2]}` : "bad";
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  // 둘을 한꺼번에 (제작자 2026-11-10 '전반적으로 렉': 닉네임이 뜨는 화면마다 부른다)
  const [{ results }, high] = await Promise.all([
    env.DB.prepare(
      "SELECT u.id AS id, u.role AS role, COALESCE(NULLIF(u.kakao, ''), NULLIF(m.kakao, '')) AS link FROM users u LEFT JOIN users m ON m.id = u.main_id " +
        "WHERE COALESCE(NULLIF(u.kakao, ''), NULLIF(m.kakao, '')) IS NOT NULL",
    ).all<{ id: string; role: Role; link: string }>(),
    env.DB.prepare("SELECT id FROM users WHERE high_spec = 1").all<{ id: string }>(),
  ]);
  const rows = results.filter((r) => !TEST_IDS.includes(r.id));
  return json(
    {
      links: Object.fromEntries(rows.map((r) => [r.id, r.link])),
      // 장비대여 담당(길드마스터, server/rental.ts RENT_STAFF) 중 링크가 있는 사람: 장비대여 신청함의 '담당자 카톡'
      // (앱개발자는 길드 직책이 아니라 빼고, 다른 오피서도 빼고. 제작자 요청 2026-11-02)
      // 담당자는 대여 담당(멍멍)만 (제작자 2026-11-03 '장비대여 담당자는 멍멍이야, 마을모금함은 길드마스터라 모든 권한이 있는 것뿐'). 길드마스터·앱개발자는 운영 권한만 있고 담당자 줄에는 안 나온다
      staff: rows.filter((r) => RENT_STAFF.includes(r.id)).map((r) => r.id),
      high: high.results.map((r) => r.id),
    },
    200,
    { "cache-control": "no-store" },
  );
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const b = await readJson<{ link: unknown; user: unknown }>(request);
  const link = readKakao(b.link);
  if (link === "bad") return json({ error: "카톡 오픈프로필 링크(open.kakao.com/...)를 붙여 넣어 주세요" }, 400);
  const target = typeof b.user === "string" && b.user.trim() ? b.user.trim() : me.id;
  const user = await env.DB.prepare("SELECT id, role, main_id FROM users WHERE id = ?").bind(target).first<{ id: string; role: Role; main_id: string | null }>();
  if (!user) return json({ error: "없는 아이디예요" }, 404);
  // 내 캐릭터이거나 그 사람을 다룰 수 있는 운영진만
  if (!samePerson(me, user) && !(RANK[me.role] >= 1 && (await canManageUser(env, me.role, user.id, user.role)))) return FORBIDDEN();
  await env.DB.prepare("UPDATE users SET kakao = ? WHERE id = ?").bind(link, user.id).run();
  return json({ ok: true, link });
};
