// 내 지역 날씨로 홈 화면에 비·눈 (제작자 요청 2026-11-02 초안: '위치정보 허용하면 사는 지역 그날 날씨에 따라 화면에 눈 오게 비 오게').
// - 위치: 폰이 허락했을 때만 브라우저에서 받는다 (navigator.geolocation, 정확도 낮게). 소수 둘째 자리(1km 쯤)로 줄여 이 기기에만 30분 둔다.
//   우리 서버에는 보내거나 저장하지 않는다.
// - 날씨: Open-Meteo (무료, 키 없음, 기상청 자료 포함)에 브라우저가 바로 묻는다. 'current' 의 WMO 날씨 코드로 맑음·비·눈·천둥 …
// - 게임과 상관없는 화면 꾸밈이라 게임 안전 규칙에 맞는다. 게임 위 위키 창(inFloat)에서는 쓰지 않는다.
// 지금은 초안이라 앱개발자(와 테스트 계정)에게만 보인다 (WEATHER_OPEN). 앱개발자는 아래 날씨 표를 눌러 효과를 하나씩 미리 본다.
// 켜고 끄기는 '내 정보'의 '날씨 효과' (제작자 요청 2026-11-02: 위치를 허용했을 때만 뜨게, 허용은 내 정보에서 켜고 끄게). 홈에서 따로 묻지 않는다.
import { useEffect, useState } from "react";
import { inFloat } from "./platform";

/** 초안: 열기 전에는 앱개발자와 테스트 계정만 */
export const WEATHER_OPEN = false;

/** 화면 효과. 안개는 뺐다 (제작자 요청 2026-11-02: '안개는 하지 마') */
export type Sky = "clear" | "cloud" | "drizzle" | "rain" | "heavy" | "snow" | "blizzard" | "storm";
export interface Weather {
  sky: Sky;
  /** 기온 °C */
  temp: number | null;
  /** 낮인지 (밤이면 맑음 표가 🌙) */
  day: boolean;
  /** 받은 때 */
  at: number;
}

/** WMO 날씨 코드 -> 화면 효과 (https://open-meteo.com/en/docs 의 weather_code) */
export function skyOf(code: number): Sky {
  if (code >= 95) return "storm"; // 95 뇌우, 96·99 우박 섞인 뇌우
  if (code === 75 || code === 86) return "blizzard"; // 많은 눈, 강한 눈 소나기
  if ((code >= 71 && code <= 77) || code === 85) return "snow";
  if (code === 65 || code === 67 || code === 82) return "heavy"; // 강한 비, 강한 어는비, 강한 소나기
  if ((code >= 61 && code <= 66) || code === 80 || code === 81) return "rain";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code === 3 || code === 45 || code === 48) return "cloud"; // 안개는 흐림으로 (효과 없음)
  return "clear";
}

export const SKY_NAME: Record<Sky, string> = {
  clear: "맑음",
  cloud: "흐림",
  drizzle: "이슬비",
  rain: "비",
  heavy: "폭우",
  snow: "눈",
  blizzard: "함박눈",
  storm: "천둥번개",
};
export function skyIcon(sky: Sky, day = true): string {
  return { clear: day ? "☀️" : "🌙", cloud: "☁️", drizzle: "🌦️", rain: "🌧️", heavy: "🌧️", snow: "🌨️", blizzard: "❄️", storm: "⛈️" }[sky];
}
/** 앱개발자 미리 보기 순서 (날씨 표를 누를 때마다 다음 것, 마지막 다음은 실제 날씨) */
export const PREVIEW: Sky[] = ["drizzle", "rain", "heavy", "storm", "snow", "blizzard"];

const PREF = "sapphire.wx"; // '1' 켬 (내 정보에서 켜고 위치를 허락했을 때), 아니면 끔
const CACHE = "sapphire.wx.cache";
const FRESH = 30 * 60_000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // 못 적으면 이번만
  }
}

/** 이 기기의 위치 (허락을 묻는 창은 처음 한 번 폰이 띄운다) */
function position(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("위치를 쓸 수 없는 브라우저예요"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }),
      (e) => reject(e),
      { enableHighAccuracy: false, maximumAge: FRESH, timeout: 15_000 },
    );
  });
}

async function fetchWeather(lat: number, lon: number): Promise<Weather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,temperature_2m,is_day&timezone=Asia%2FSeoul`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`날씨 ${res.status}`);
    const j = (await res.json()) as { current?: { weather_code?: number; temperature_2m?: number; is_day?: number } };
    const c = j.current ?? {};
    return { sky: skyOf(Number(c.weather_code ?? 0)), temp: typeof c.temperature_2m === "number" ? Math.round(c.temperature_2m) : null, day: c.is_day !== 0, at: Date.now() };
  } finally {
    clearTimeout(t);
  }
}

/** 지금 날씨 (30분 안에 받은 것이 있으면 그것) */
export async function loadWeather(force = false): Promise<Weather> {
  if (!force) {
    try {
      const c = JSON.parse(read(CACHE) ?? "null") as Weather | null;
      if (c && c.sky in SKY_NAME && Date.now() - c.at < FRESH) return c;
    } catch {
      // 다시 받는다
    }
  }
  const { lat, lon } = await position();
  const w = await fetchWeather(lat, lon);
  write(CACHE, JSON.stringify(w));
  return w;
}

export type WxState = { status: "off" } | { status: "loading" } | { status: "on"; weather: Weather };

/** 내 정보의 '날씨 효과'가 켜져 있는지 */
export const weatherOn = () => read(PREF) === "1";

/**
 * 내 정보의 '날씨 효과' 켜기·끄기. 켤 때 폰이 위치 허락을 묻고, 허락하지 않으면 켜지지 않는다 (오류 글을 돌려준다)
 */
export async function setWeatherOn(on: boolean): Promise<string | null> {
  if (!on) {
    write(PREF, "0");
    try {
      localStorage.removeItem(CACHE);
    } catch {
      // 다음에 다시 받는다
    }
    return null;
  }
  try {
    await loadWeather(true);
    write(PREF, "1");
    return null;
  } catch (e) {
    write(PREF, "0");
    const code = typeof e === "object" && e !== null ? (e as GeolocationPositionError).code : 0;
    if (code === 1) return "위치를 허용해야 켜져요. 폰 설정에서 이 사이트의 위치를 허용해 주세요";
    if (code === 2 || code === 3) return "위치를 못 받았어요. 잠시 뒤 다시 눌러 주세요";
    return e instanceof Error ? e.message : "날씨를 못 받았어요";
  }
}

/** 홈의 날씨: 내 정보에서 켜 두었을 때만 받아 온다 (위치를 허용하지 않았으면 아무것도 안 보인다) */
export function useWeather(allowed: boolean) {
  const [state, setState] = useState<WxState>({ status: "off" });
  useEffect(() => {
    if (!allowed || inFloat || !weatherOn()) return;
    let gone = false;
    const start = () => {
      setState((s) => (s.status === "on" ? s : { status: "loading" }));
      loadWeather()
        .then((weather) => !gone && setState({ status: "on", weather }))
        .catch((e: unknown) => {
          // 위치 허락을 거두었으면 끈다
          if (typeof e === "object" && e !== null && (e as GeolocationPositionError).code === 1) write(PREF, "0");
          if (!gone) setState({ status: "off" });
        });
    };
    start();
    // 30분마다 다시 (홈을 오래 켜 둘 때)
    const t = window.setInterval(() => {
      if (weatherOn() && document.visibilityState === "visible") start();
    }, FRESH);
    return () => {
      gone = true;
      window.clearInterval(t);
    };
  }, [allowed]);
  return state;
}
