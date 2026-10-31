// 이 웹앱이 어디서 열렸는지.
// 안드로이드 앱(Sapphire)의 WebView 는 User-Agent 끝에 "SapphireApp/버전" 을 붙인다 (MainActivity, WikiWindow).

const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;

/** 안드로이드 앱 안에서 열렸는지 */
export const inApp = /SapphireApp\//.test(ua);

/** 게임 위 위키 창(WikiWindow) 안에서 열렸는지. 그 창은 User-Agent 에 "SapphireFloat" 를 더 붙인다 */
export const inFloat = /SapphireFloat/.test(ua);

/** 앱 버전 숫자 (SapphireApp/1.16 → [1, 16]). 앱 밖이면 빈 배열 */
const appVersion = (/SapphireApp\/(\d+)\.(\d+)/.exec(ua) ?? []).slice(1).map(Number);

/**
 * 위키 아래 '앱' 탭의 sapphire:// 버튼(시계 설정 등)을 받는 앱인지. 앱 v1.16 부터 받는다.
 * 예전 앱은 윗줄 메뉴를 쓰고, 게임 위 위키 창에서는 다른 화면을 열지 않는다 (게임에서 빠져나가서).
 */
export const appMenu =
  inApp && !inFloat && appVersion.length === 2 && (appVersion[0] > 1 || appVersion[1] >= 16);

/** 안드로이드 폰 브라우저인지 (앱 받기 링크는 여기서만 보인다) */
export const isAndroid = /Android/i.test(ua);

/** 아이폰, 아이패드 */
export const isIOS = /iPhone|iPad|iPod/.test(ua);
/** 갤럭시 기본 브라우저(삼성 인터넷) */
export const inSamsung = /SamsungBrowser/.test(ua);
/** 카카오톡, 네이버 앱 안의 브라우저 (여기서는 홈 화면에 설치가 안 된다) */
export const inKakao = /KAKAOTALK/i.test(ua);
export const inNaver = /NAVER\(inapp/i.test(ua);

/** 홈 화면에 설치한 웹앱으로 열렸는지 (브라우저 주소창 없이) */
export function standalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);
}

/** 웹앱 주소 */
export const WEB_URL = "https://sapphire-guild.pages.dev";

/**
 * 안드로이드 앱을 받고 쓸 수 있는지. 제작자 요청(2026-10-31)으로 지금은 웹만 쓴다: 앱 받기는 '검토 후 오픈',
 * 이미 깐 앱은 열면 웹 주소로 안내만 한다 (pages/InstallGuide.tsx AppClosedPage). 다시 열 때 true 로.
 */
export const APP_OPEN = false;

/** 안드로이드 앱 APK. GitHub 최신 릴리스라 앱 안 업데이트와 같은 파일이다 */
export const APK_URL =
  "https://github.com/hong-seok-young/Sapphire_Pyuang/releases/latest/download/FloatingClock.apk";

/** 맨 위 'Sapphire app' / 'Sapphire web' 에 붙는 말. 홈 화면에 둘 다 깔려 있어도 들어가면 구분된다 */
export const EDITION = inApp ? "app" : "web";
