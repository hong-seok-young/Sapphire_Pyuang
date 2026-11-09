// POST /api/quest2/brackets { minLevel, maxLevel, note } -> 레벨 구간 참고표에 구간 하나 더하기 (오피서 이상, 신청·지급과는 따로인 안내용)
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { canManageQuest2, canUseQuest2, readBracketInput } from "../../../../server/quest2";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (!canUseQuest2(me) || !canManageQuest2(me.role)) return FORBIDDEN();
  const input = readBracketInput(await readJson<Record<string, unknown>>(request));
  if (typeof input === "string") return json({ error: input }, 400);
  const sort = await env.DB.prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM quest2_brackets").first<{ n: number }>();
  const row = await env.DB.prepare("INSERT INTO quest2_brackets (min_level, max_level, note, sort) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(input.minLevel, input.maxLevel, input.note, sort?.n ?? 0)
    .first<{ id: number }>();
  if (!row) return json({ error: "넣지 못했어요" }, 500);
  return json({ ok: true, id: row.id }, 201);
};
