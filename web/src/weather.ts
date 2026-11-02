// 내 지역 날씨로 홈 화면에 비·눈 (제작자 요청 2026-11-02 초안: '위치정보 허용하면 사는 지역 그날 날씨에 따라 화면에 눈 오게 비 오게').
// - 위치: 폰이 허락했을 때만 브라우저에서 받는다 (navigator.geolocation, 정확도 낮게 -> 안 되면 GPS). 소수 둘째 자리(1km 쯤)로 줄여
//   날씨는 이 기기에 30분(5km 넘게 움직이면 바로 새로), 마지막 위치는 위치를 못 받을 때 쓰려고 이 기기에만 30일 둔다. 우리 서버에는 보내거나 저장하지 않는다.
//   위치는 홈에 올 때, 앱으로 돌아올 때, 홈을 켜 둔 동안 10분마다 다시 본다 (폰이 1분 안에 잡은 위치까지 쓴다).
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
export const PREVIEW: Sky[] = ["rain", "snow", "blizzard"];

const PREF = "sapphire.wx"; // '1' 켬, '0' 끔(나중에·거절)
const CACHE = "sapphire.wx.cache";
/** 같은 곳이면 날씨를 이만큼 두고 쓴다 */
const FRESH = 30 * 60_000;
/** 위치를 다시 보는 간격 (홈을 켜 둔 동안. 앱으로 돌아오거나 홈에 올 때도 본다) */
const RECHECK = 10 * 60_000;
/** 이만큼(소수 둘째 자리로 5칸, 5km 쯤) 움직였으면 30분이 안 됐어도 날씨를 새로 받는다 */
const MOVED = 0.05;

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

/** 날씨를 못 받은 까닭: 위치(폰이 위치를 못 줌) / 날씨 서버(인터넷, Open-Meteo) */
export class WxError extends Error {
  constructor(
    public kind: "loc" | "net",
    message: string,
  ) {
    super(message);
  }
}

/** 위치 거절 (폰이 묻는 창에서 '차단' 또는 브라우저 설정에서 막힘) */
export const isDenied = (e: unknown) => typeof e === "object" && e !== null && !(e instanceof WxError) && (e as GeolocationPositionError).code === 1;

type Pos = { lat: number; lon: number };
const round = (v: number) => Math.round(v * 100) / 100;

/** 위치 한 번 묻기 (허락을 묻는 창은 처음 한 번 폰이 띄운다) */
function locate(high: boolean, timeout: number): Promise<Pos> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new WxError("loc", "위치를 쓸 수 없는 브라우저"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: round(p.coords.latitude), lon: round(p.coords.longitude) }),
      (e) => reject(e),
      // 폰이 들고 있는 위치는 1분까지만 쓴다 (움직이면 따라가게, 제작자 2026-11-02 '실시간으로 이동되는 것까지')
      { enableHighAccuracy: high, maximumAge: 60_000, timeout },
    );
  });
}

/** 마지막으로 받은 위치 (1km 쯤으로 줄인 것, 이 기기에만): 위치를 못 받을 때 쓴다 */
const POS = "sapphire.wx.pos";
const POS_KEEP = 30 * 24 * 60 * 60_000;
function savedPos(): Pos | null {
  try {
    const p = JSON.parse(read(POS) ?? "null") as (Pos & { at: number }) | null;
    if (p && typeof p.lat === "number" && typeof p.lon === "number" && Date.now() - p.at < POS_KEEP) return { lat: p.lat, lon: p.lon };
  } catch {
    // 없음
  }
  return null;
}

/**
 * 이 기기의 위치 (2026-11-02: 홈에 '날씨를 못 받았어요'. 정확도 낮게만 물으면 안드로이드에서 'Google 위치 정확도'가 꺼져 있거나
 * 실내라 망 위치가 없을 때 15초를 기다리다 끝났다): 정확도 낮게 10초 -> 안 되면 GPS 로 20초 -> 그래도 안 되면 이 기기의 마지막 위치.
 * 거절은 그대로 넘긴다 (다시 묻지 않게)
 */
async function position(): Promise<Pos> {
  let last: unknown;
  for (const [high, timeout] of [
    [false, 10_000],
    [true, 20_000],
  ] as const) {
    try {
      const p = await locate(high, timeout);
      write(POS, JSON.stringify({ ...p, at: Date.now() }));
      return p;
    } catch (e) {
      if (isDenied(e) || e instanceof WxError) throw e;
      last = e;
    }
  }
  const saved = savedPos();
  if (saved) return saved;
  const code = (last as GeolocationPositionError | undefined)?.code;
  throw new WxError("loc", code === 3 ? "위치 시간 초과" : "위치를 찾지 못함");
}

async function fetchOnce(lat: number, lon: number): Promise<Weather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,temperature_2m,is_day&timezone=Asia%2FSeoul`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new WxError("net", `날씨 서버 ${res.status}`);
    const j = (await res.json()) as { current?: { weather_code?: number; temperature_2m?: number; is_day?: number } };
    const c = j.current;
    if (!c || typeof c.weather_code !== "number") throw new WxError("net", "날씨 자료가 비었음");
    return { sky: skyOf(c.weather_code), temp: typeof c.temperature_2m === "number" ? Math.round(c.temperature_2m) : null, day: c.is_day !== 0, at: Date.now() };
  } catch (e) {
    throw e instanceof WxError ? e : new WxError("net", "날씨 서버 연결 안 됨");
  } finally {
    clearTimeout(t);
  }
}

/** 날씨 받기 (인터넷이 잠깐 끊긴 것이면 한 번 더) */
async function fetchWeather(lat: number, lon: number): Promise<Weather> {
  try {
    return await fetchOnce(lat, lon);
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    return fetchOnce(lat, lon);
  }
}

type Cached = Weather & { lat?: number; lon?: number };
function readCache(): Cached | null {
  try {
    return JSON.parse(read(CACHE) ?? "null") as Cached | null;
  } catch {
    return null;
  }
}
/** 화면을 열자마자 보일 지난 날씨 (3시간 안에 받은 것, 그 뒤 loadWeather 가 새로 맞춘다) */
export function cachedWeather(): Weather | null {
  const c = readCache();
  return c && Date.now() - c.at < 3 * 60 * 60_000 ? c : null;
}

/**
 * 지금 있는 곳의 날씨: 위치는 매번 다시 보고(폰이 1분 안에 잡은 위치까지), 같은 곳(5km 안)에서 30분 안에 받은 날씨면 그것을 쓴다.
 * 그보다 멀리 움직였거나 30분이 지났으면 새로 받는다
 */
export async function loadWeather(force = false): Promise<Weather> {
  const { lat, lon } = await position();
  const c = readCache();
  const near = c?.lat !== undefined && c.lon !== undefined && Math.abs(c.lat - lat) < MOVED && Math.abs(c.lon - lon) < MOVED;
  if (!force && c && near && Date.now() - c.at < FRESH) return c;
  const w = await fetchWeather(lat, lon);
  write(CACHE, JSON.stringify({ ...w, lat, lon }));
  return w;
}

/** 폰이 위치를 이미 허락했는지 ('granted' | 'denied' | 'prompt', 모르면 null: 아이폰 예전 사파리 등) */
export async function permission(): Promise<PermissionState | null> {
  try {
    const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return p?.state ?? null;
  } catch {
    return null;
  }
}

/** 내 정보의 '날씨 반영' (제작자 요청 2026-11-02 '내 정보에서 위치 허용하게, 날씨 반영된다고'): 켜 두었는지 */
export const weatherOn = () => read(PREF) === "1";
/** 켜기: 여기서 폰이 위치 허락을 묻는다. 거절하면 꺼 둔다 (홈 카드의 '켜기'와 같다) */
export async function enableWeather(): Promise<Weather> {
  write(PREF, "1");
  try {
    return await loadWeather(true);
  } catch (e) {
    if (isDenied(e)) write(PREF, "0");
    throw e;
  }
}
export const disableWeather = () => write(PREF, "0");

export type WxState =
  | { status: "off" }
  | { status: "ask" }
  | { status: "loading" }
  | { status: "on"; weather: Weather }
  | { status: "error"; kind: "loc" | "net"; reason: string };

/**
 * 홈의 날씨: 켜 두었으면 받아 오고, 아직 안 정했으면 'ask'(홈에 켜기 카드). 'enable' 은 카드의 '켜기' (여기서 폰이 허락을 묻는다)
 */
export function useWeather(allowed: boolean) {
  const [state, setState] = useState<WxState>({ status: "off" });
  const start = (force = false) => {
    // 지난 날씨가 있으면 그것부터 보이고 뒤에서 새로 맞춘다
    const last = cachedWeather();
    setState((s) => (s.status === "on" ? s : last ? { status: "on", weather: last } : { status: "loading" }));
    loadWeather(force)
      .then((weather) => setState({ status: "on", weather }))
      .catch((e: unknown) => {
        if (isDenied(e)) {
          write(PREF, "0");
          return setState({ status: "off" });
        }
        const err = e instanceof WxError ? e : new WxError("loc", "위치를 못 받음");
        setState({ status: "error", kind: err.kind, reason: err.message });
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
    // 움직이면 따라간다: 홈을 켜 둔 동안 10분마다, 다른 앱에 갔다가 돌아올 때마다 위치를 다시 본다 (날씨는 5km 넘게 움직였거나 30분이 지났을 때만 새로)
    const again = () => {
      if (!gone && read(PREF) === "1" && document.visibilityState === "visible") start();
    };
    const t = window.setInterval(again, RECHECK);
    document.addEventListener("visibilitychange", again);
    return () => {
      gone = true;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", again);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);
  return {
    state,
    /** '날씨를 못 받았어요' 를 누르면 다시 */
    retry: () => start(true),
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
