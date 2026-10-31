// POST /api/avatar/cutout (본문: 자른 캐릭터 그림 JPEG/PNG) -> 배경을 지운 PNG (제작자 요청: 캐릭터 사진 AI 오려내기)
// Cloudflare 이미지 변환의 배경 지우기(segment=foreground, BiRefNet)를 쓴다. 변환은 주소로 그림을 읽으므로
// 그림을 잠깐 D1 cutout_tmp 에 두고 아무도 못 맞힐 주소(/api/avatar/cutout/:id)로 읽힌 뒤 바로 지운다.
// 길드원이 갤러리에서 직접 고른 자기 캐릭터 스샷을 화면에서 자른 것만 받는다 (앱은 화면을 찍지 않는다. CLAUDE.md 게임 안전 규칙)
import { NEED_LOGIN, currentUser, json } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";

const MAX_BYTES = 1_500_000;
/** 한 사람 하루 횟수 (이미지 변환 무료 한도를 지키려고) */
const DAILY = 30;
const DAY_MS = 86_400_000;

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b: Uint8Array) => [0x89, 0x50, 0x4e, 0x47].every((v, i) => b[i] === v);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return json({ error: "그림이 너무 커요" }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BYTES) return json({ error: "그림이 너무 커요" }, 413);
  if (!isJpeg(bytes) && !isPng(bytes)) return json({ error: "JPEG, PNG 그림만 돼요" }, 400);

  const now = Date.now();
  const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM cutout_log WHERE user_id = ? AND at > ?").bind(me.id, now - DAY_MS).first<{ n: number }>();
  if ((used?.n ?? 0) >= DAILY) return json({ error: `AI 지우기는 하루 ${DAILY}번까지예요` }, 429);

  const id = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM cutout_tmp WHERE created_at < ?").bind(now - 5 * 60_000),
    env.DB.prepare("INSERT INTO cutout_tmp (id, img, type, created_at) VALUES (?, ?, ?, ?)").bind(id, bytes, isPng(bytes) ? "image/png" : "image/jpeg", now),
    env.DB.prepare("INSERT INTO cutout_log (user_id, at) VALUES (?, ?)").bind(me.id, now),
    env.DB.prepare("DELETE FROM cutout_log WHERE at < ?").bind(now - DAY_MS),
  ]);
  try {
    const src = new URL(`/api/avatar/cutout/${id}`, request.url).toString();
    const res = await fetch(src, { cf: { image: { segment: "foreground", format: "png" } } } as RequestInit);
    // 변환이 안 되면 원래 그림이 그대로 온다: cf-resized 머리글로 안다
    if (!res.ok || !res.headers.get("cf-resized") || !(res.headers.get("content-type") ?? "").includes("png")) {
      return json({ error: "AI 지우기를 하지 못했어요. 손으로 지워 주세요" }, 502);
    }
    return new Response(res.body, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  } finally {
    await env.DB.prepare("DELETE FROM cutout_tmp WHERE id = ?").bind(id).run();
  }
};
