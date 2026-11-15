// GET /api/weather?lat=37.57&lon=126.98 -> { sky, temp, day } (로그인한 길드원)
// 홈 날씨 효과의 대신 길 (2026-11-15 Open-Meteo 가 답하지 않아 '날씨 연결이 안 돼요'): 화면은 먼저 Open-Meteo 에 바로 묻고(src/weather.ts),
// 안 되면 여기로 온다. 노르웨이 기상청(api.met.no, 무료, 키 없음, 부르는 쪽을 알리는 User-Agent 필요)에 묻는다.
// 위치는 화면이 이미 소수 둘째 자리(1km 쯤)로 줄여 보내고, 여기서는 저장하지 않는다 (GET 이라 사용 기록에도 안 남는다).
// 같은 곳은 20분 동안 Cloudflare 캐시로 같이 쓴다 (met.no 이용 규칙도 너무 자주 묻지 말라고 한다).
import { NEED_LOGIN, currentUser, json } from "../../server/auth";
import type { Env } from "../../server/auth";

type Sky = "clear" | "cloud" | "fog" | "drizzle" | "rain" | "heavy" | "snow" | "blizzard" | "storm";

/** met.no symbol_code ('lightrainshowers_day', 'heavysnow', 'rainandthunder' …) -> 화면 효과 */
function skyOfSymbol(code: string): Sky {
  const c = code.replace(/_(day|night|polartwilight)$/, "");
  if (c.includes("thunder")) return "storm";
  if (c.includes("sleet")) return c.startsWith("heavy") ? "heavy" : "rain";
  if (c.includes("snow")) return c.startsWith("heavy") ? "blizzard" : "snow";
  if (c.includes("rain")) return c.startsWith("heavy") ? "heavy" : c.startsWith("light") ? "drizzle" : "rain";
  if (c === "fog") return "fog";
  if (c === "cloudy") return "cloud";
  return "clear"; // clearsky, fair, partlycloudy
}

interface MetNo {
  properties?: {
    timeseries?: {
      data?: {
        instant?: { details?: { air_temperature?: number } };
        next_1_hours?: { summary?: { symbol_code?: string } };
        next_6_hours?: { summary?: { symbol_code?: string } };
      };
    }[];
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const q = new URL(request.url).searchParams;
  const lat = Math.round(Number(q.get("lat")) * 100) / 100;
  const lon = Math.round(Number(q.get("lon")) * 100) / 100;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: "위치가 맞지 않아요" }, 400);

  const cache = caches.default;
  const key = new Request(`https://cache.sapphire/weather/v1/${lat}/${lon}`);
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, { headers: { "content-type": "application/json", "cache-control": "no-store" } });

  let j: MetNo;
  try {
    const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`, {
      headers: { "user-agent": "sapphire-guild-portal/1.0 https://sapphire-guild.pages.dev" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return json({ error: `날씨 서버 ${res.status}` }, 502);
    j = (await res.json()) as MetNo;
  } catch {
    return json({ error: "날씨 서버 연결 안 됨" }, 502);
  }
  const now = j.properties?.timeseries?.[0]?.data;
  const symbol = now?.next_1_hours?.summary?.symbol_code ?? now?.next_6_hours?.summary?.symbol_code;
  if (!symbol) return json({ error: "날씨 자료가 비었음" }, 502);
  const temp = now?.instant?.details?.air_temperature;
  // 낮·밤: 기호 끝 _night 이면 밤, 끝이 없는 기호(흐림·비)는 한국 시간 6~18시를 낮으로
  const hour = new Date(Date.now() + 9 * 3600_000).getUTCHours();
  const day = symbol.endsWith("_night") ? false : symbol.endsWith("_day") ? true : hour >= 6 && hour < 18;
  const body = JSON.stringify({ sky: skyOfSymbol(symbol), temp: typeof temp === "number" ? Math.round(temp) : null, day });
  waitUntil(cache.put(key, new Response(body, { headers: { "content-type": "application/json", "cache-control": "max-age=1200" } })));
  return new Response(body, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};
