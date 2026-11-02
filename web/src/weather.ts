// 내 지역 날씨로 홈 화면에 비·눈 (제작자 요청 2026-11-02 초안: '위치정보 허용하면 사는 지역 그날 날씨에 따라 화면에 눈 오게 비 오게').
// - 위치: 폰이 허락했을 때만 브라우저에서 받는다 (navigator.geolocation, 정확도 낮게). 소수 둘째 자리(1km 쯤)로 줄여 이 기기에만 30분 둔다.
//   우리 서버에는 보내거나 저장하지 않는다.
// - 날씨: Open-Meteo (무료, 키 없음, 기상청 자료 포함)에 브라우저가 바로 묻는다. 'current' 의 WMO 날씨 코드로 맑음·비·눈·천둥 …
// - 게임과 상관없는 화면 꾸밈이라 게임 안전 규칙에 맞는다. 게임 위 위키 창(inFloat)에서는 쓰지 않는다.
// 지금은 초안이라 앱개발자(와 테스트 계정)에게만 보인다 (WEATHER_OPEN). 앱개발자는 아래 날씨 표를 눌러 효과를 하나씩 미리 본다.
import { useEffect, useState } from "react";
import { inFloat } from "./platform";

/** 초안: 열기 전에는 앱개발자와 테스트 계정만 */
export const WEATHER_OPEN = false;

export type Sky = "clear" | "cloud" | "fog" | "drizzle" | "rain" | "heavy" | "snow" | "blizzard" | "storm";
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
  if (code === 45 || code === 48) return "fog";
  if (code === 3) return "cloud";
  return "clear";
}

export const SKY_NAME: Record<Sky, string> = {
  clear: "맑음",
  cloud: "흐림",
  fog: "안개",
  drizzle: "이슬비",
  rain: "비",
  heavy: "폭우",
  snow: "눈",
  blizzard: "함박눈",
  storm: "천둥번개",
};
export function skyIcon(sky: Sky, day = true): string {
  return { clear: day ? "☀️" : "🌙", cloud: "☁️", fog: "🌫️", drizzle: "🌦️", rain: "🌧️", heavy: "🌧️", snow: "🌨️", blizzard: "❄️", storm: "⛈️" }[sky];
}
/** 앱개발자 미리 보기 순서 (날씨 표를 누를 때마다 다음 것, 마지막 다음은 실제 날씨) */
export const PREVIEW: Sky[] = ["drizzle", "rain", "heavy", "storm", "snow", "blizzard", "fog"];

const PREF = "sapphire.wx"; // '1' 켬, '0' 끔(나중에·거절)
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
      if (c && Date.now() - c.at < FRESH) return c;
    } catch {
      // 다시 받는다
    }
  }
  const { lat, lon } = await position();
  const w = await fetchWeather(lat, lon);
  write(CACHE, JSON.stringify(w));
  return w;
}

/** 폰이 위치를 이미 허락했는지 ('granted' | 'denied' | 'prompt', 모르면 null: 아이폰 예전 사파리 등) */
async function permission(): Promise<PermissionState | null> {
  try {
    const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return p?.state ?? null;
  } catch {
    return null;
  }
}

export type WxState = { status: "off" } | { status: "ask" } | { status: "loading" } | { status: "on"; weather: Weather } | { status: "error"; reason: string };

/**
 * 홈의 날씨: 켜 두었으면 받아 오고, 아직 안 정했으면 'ask'(홈에 켜기 카드). 'enable' 은 카드의 '켜기' (여기서 폰이 허락을 묻는다)
 */
export function useWeather(allowed: boolean) {
  const [state, setState] = useState<WxState>({ status: "off" });
  const start = (force = false) => {
    setState((s) => (s.status === "on" ? s : { status: "loading" }));
    loadWeather(force)
      .then((weather) => setState({ status: "on", weather }))
      .catch((e: unknown) => {
        const denied = typeof e === "object" && e !== null && (e as GeolocationPositionError).code === 1;
        if (denied) write(PREF, "0");
        setState(denied ? { status: "off" } : { status: "error", reason: e instanceof Error ? e.message : "위치를 못 받았어요" });
      });
  };
  useEffect(() => {
    if (!allowed || inFloat) return;
    let gone = false;
    const pref = read(PREF);
    if (pref === "1") start();
    else if (pref !== "0")
      void permission().then((p) => {
        if (gone) return;
        if (p === "granted") {
          write(PREF, "1");
          start();
        } else if (p !== "denied") setState({ status: "ask" });
      });
    // 30분마다 다시 (홈을 오래 켜 둘 때)
    const t = window.setInterval(() => {
      if (read(PREF) === "1" && document.visibilityState === "visible") start();
    }, FRESH);
    return () => {
      gone = true;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);
  return {
    state,
    enable: () => {
      write(PREF, "1");
      start(true);
    },
    later: () => {
      write(PREF, "0");
      setState({ status: "off" });
    },
  };
}
