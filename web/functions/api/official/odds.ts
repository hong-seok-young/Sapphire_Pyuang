// GET /api/official/odds -> { boxes: EventBox[] } 공식 이벤트 글 그림 속 확률표 (확률 시뮬레이터 뽑기의 '이벤트 공지', server/officialOdds.ts).
// 그림 글자를 훑어서 6시간 캐시한다 (Cloudflare 캐시, 로그인 확인은 그대로). 로그인한 길드원 누구나
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { eventBoxes } from "../../../server/officialOdds";

const TTL = 6 * 3600;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const cacheKey = new Request("https://cache.sapphire/official-odds/v2");
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey).catch(() => undefined);
  if (hit) return json(await hit.json());
  const body = { boxes: await eventBoxes(env) };
  waitUntil(
    cache.put(cacheKey, new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": `max-age=${TTL}` } })).catch(() => undefined),
  );
  return json(body);
};
