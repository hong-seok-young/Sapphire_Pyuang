// GET /api/official/item?name=아이템 -> { items: ItemEvent[] } 그 아이템이 나오는 공식 글 (위키 아이템 화면 '공식 이벤트·소식', server/officialItem.ts).
// 그림 글자·본문 표를 훑어서 D1 읽기가 크므로 이름마다 6시간 캐시한다 (Cloudflare 캐시, 로그인 확인은 그대로). 로그인한 길드원 누구나
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { itemEvents } from "../../../server/officialItem";

const TTL = 6 * 3600;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const name = (new URL(request.url).searchParams.get("name") ?? "").trim().slice(0, 60);
  if (!name) return json({ items: [] });
  const cacheKey = new Request(`https://cache.sapphire/official-item/v1/${encodeURIComponent(name)}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey).catch(() => undefined);
  if (hit) return json(await hit.json());
  const body = { items: await itemEvents(env, name) };
  waitUntil(
    cache
      .put(cacheKey, new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": `max-age=${TTL}` } }))
      .catch(() => undefined),
  );
  return json(body);
};
