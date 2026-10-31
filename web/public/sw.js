// 폰 알림을 받는 서비스 워커 (server/push.ts, web/src/push.ts). 화면 파일을 저장해 두지는 않는다 (fetch 를 가로채지 않음).
// 서버는 '새 알림' 신호만 보내므로, 받으면 내 알림 목록에서 가장 새 것을 가져와 간략 내용과 함께 띄운다.
// 누르면 그 글이 있는 화면을 연다. 주소의 ?icon= 은 manifest start_url 과 같은 판 (platform.ts ICON_VERSION, 바꾸면 같이 바꾼다)
const ICON_VERSION = "2026-10-31-galaxy";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  e.waitUntil(
    (async () => {
      let latest = null;
      let unread = 0;
      try {
        const res = await fetch("/api/alerts", { credentials: "include", cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          latest = (data.alerts || [])[0] || null;
          unread = data.unread || 0;
        }
      } catch (err) {
        // 글을 못 가져오면 '새 알림'만 알린다
      }
      await self.registration.showNotification("Sapphire", {
        body: latest ? latest.text : "새 알림이 있어요",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: latest ? "alert-" + latest.id : "alert",
        data: { link: (latest && latest.link) || "#/alerts" },
        ...(unread > 1 ? { renotify: false } : {}),
      });
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = self.registration.scope + "?icon=" + ICON_VERSION + (e.notification.data && e.notification.data.link ? e.notification.data.link : "#/alerts");
  e.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of list) {
        if ("focus" in c) {
          try {
            await c.navigate(url);
          } catch (err) {
            // 다른 탭이면 열기만
          }
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
