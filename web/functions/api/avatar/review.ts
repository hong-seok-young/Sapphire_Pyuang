// POST /api/avatar/review { original, cutout, w, h, again } -> { remove: [{x, y, what}], keep: [{x, y, what}] }
// again: 첫 검수대로 지운 뒤 한 번 더 (남은 것은 remove, 잘못 지워진 캐릭터 부분은 keep 으로 되살린다)
// 캐릭터 사진 AI 보정의 둘째 단계 (제작자 2026-11-10: '왼쪽 발밑 회색 동그라미가 누끼가 안 따진다, AI 보정 제대로 되게').
// 배경 지우기 AI(cutout/index.ts, BiRefNet)는 캐릭터에 붙은 바닥 물체, 뒤의 동상, 꽃, 이름표를 같이 남긴다.
// 원래 스샷과 배경을 지운 결과를 Claude 가 보고, 캐릭터가 아닌 것마다 그 안쪽에 점(remove), 캐릭터의 각 부분에 점(keep)을 찍는다.
// 화면(AvatarMaker.tsx)이 그 점에서 색 경계를 따라 퍼져서(geodesic) 캐릭터가 아닌 덩어리만 지운다.
// 길드원이 갤러리에서 직접 고른 자기 캐릭터 스샷을 화면에서 자른 것만 받는다 (앱은 화면을 찍지 않는다. CLAUDE.md 게임 안전 규칙).
// 그림은 저장하지 않는다. 못 하면 빈 목록 (화면은 배경 지우기 결과를 그대로 쓴다)
import Anthropic from "@anthropic-ai/sdk";
import { NEED_LOGIN, currentUser, json, readJson } from "../../../server/auth";
import { reviewPoints } from "../../../server/avatarReview";
import type { Env } from "../../../server/auth";
import { trackUsage } from "../../../server/apiUsage";

const MAX_B64 = 2_500_000;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const empty = { remove: [], keep: [] };
  if (!env.ANTHROPIC_API_KEY) return json(empty);
  const body = await readJson<{ original?: unknown; cutout?: unknown; w?: unknown; h?: unknown; again?: unknown }>(request);
  const w = Number(body.w);
  const h = Number(body.h);
  const ok = (s: unknown): s is string => typeof s === "string" && s.length > 100 && s.length < MAX_B64;
  if (!ok(body.original) || !ok(body.cutout) || !(w >= 16 && w <= 2048 && h >= 16 && h <= 2048)) return json({ error: "그림을 다시 골라 주세요" }, 400);
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  try {
    return json(await reviewPoints(client, body.original, body.cutout, w, h, body.again === true, (res) => trackUsage(env, me.id, "avatar", res)));
  } catch (e) {
    console.error("avatar review", String((e as Error).message).slice(0, 300));
    return json(empty);
  }
};
