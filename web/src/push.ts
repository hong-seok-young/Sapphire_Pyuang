// 폰 자체 알림 켜고 끄기 (제작자 요청, 서버 server/push.ts, 서비스 워커 public/sw.js).
// 이 폰에서 알림 권한을 받고 푸시 구독을 만들어 서버에 알린다. 아이폰은 홈 화면에 설치한 웹앱에서만 된다
import { api } from "./auth";
import { isIOS, standalone } from "./platform";

export type PushState = "unsupported" | "ios-install" | "denied" | "off" | "on";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** 서비스 워커 등록 (앱을 열 때 한 번. 화면 파일을 저장하지는 않는다) */
export function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return isIOS && !standalone() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(b64: string): Uint8Array {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** 켜기: 권한 묻기 -> 구독 -> 서버에 이 폰 알리기 */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return pushState();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await api<{ publicKey: string }>("/api/push");
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  }
  await api("/api/push", "PUT", { endpoint: sub.endpoint });
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api("/api/push", "DELETE", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  return "off";
}
