// 이 웹앱이 어디서 열렸는지.
// 안드로이드 앱(Sapphire)의 WebView 는 User-Agent 끝에 "SapphireApp/버전" 을 붙인다 (MainActivity, WikiWindow).

const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;

/** 안드로이드 앱 안에서 열렸는지 */
export const inApp = /SapphireApp\//.test(ua);

/** 안드로이드 폰 브라우저인지 (앱 받기 링크는 여기서만 보인다) */
export const isAndroid = /Android/i.test(ua);

/** 안드로이드 앱 APK. GitHub 최신 릴리스라 앱 안 업데이트와 같은 파일이다 */
export const APK_URL =
  "https://github.com/hong-seok-young/Sapphire_Pyuang/releases/latest/download/FloatingClock.apk";
