// PUT /api/gd/open { open: boolean } -> 파티 명단을 모두에게 열기 / 공지까지 숨기기 (길드마스터·앱개발자, server/gdungeon.ts partiesOpen, D1 setup 'gd_parties_open')
//   제작자 2026-11-03 '공지까지 숨기기 버튼 어딨음': 길드 던전 화면 맨 위 줄의 '명단 열기'(정말 열기) · '공지까지 숨기기'.
//   열면 파티에 든 사람 모두에게 알림 (숨긴 동안은 파티 알림이 안 갔으니 '명단이 열렸어요 · 시간표를 칠해 주세요'). 숨기기는 알리지 않는다.
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { OPEN_KEY, canOpenParties, partiesOpen } from "../../../server/gdungeon";
import { notify } from "../../../server/alerts";

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canOpenParties(me)) return FORBIDDEN();
  const b = await readJson<{ open: unknown }>(request);
  if (typeof b.open !== "boolean") return json({ error: "열기인지 숨기기인지 골라 주세요" }, 400);
  const was = await partiesOpen(env);
  if (b.open === was) return json({ open: was });
  if (b.open) {
    await env.DB.prepare("INSERT OR REPLACE INTO setup (key, done_at) VALUES (?, ?)").bind(OPEN_KEY, Date.now()).run();
    const { results } = await env.DB.prepare("SELECT DISTINCT user_id FROM gd_members").all<{ user_id: string }>();
    await notify(env, results.map((r) => r.user_id), "gdungeon", "길드 던전 파티 명단이 열렸어요 · 내 파티를 보고 이번 주 시간표를 칠해 주세요", "#/match", me.id);
  } else {
    await env.DB.prepare("DELETE FROM setup WHERE key = ?").bind(OPEN_KEY).run();
  }
  return json({ open: b.open });
};
