// 폰 알림을 받는 서비스 워커 (server/push.ts, web/src/push.ts). 화면 파일을 저장해 두지는 않는다 (fetch 를 가로채지 않음).
// 서버는 '새 알림' 신호만 보내므로, 받으면 내 알림 목록에서 가장 새 것을 가져와 간략 내용과 함께 띄운다.
// 누르면 그 글이 있는 화면을 연다. 주소의 ?icon= 은 manifest start_url 과 같은 판 (platform.ts ICON_VERSION, 바꾸면 같이 바꾼다)
const ICON_VERSION = "2026-10-31-galaxy";

// 알림 제목: 무슨 알림인지 (제작자 요청: 알림 내용이 뭔지 보이게). 종류는 server/alerts.ts ALERT_KINDS, 이름은 src/alerts.ts ALERT_GROUPS
const KIND_TITLE = {
  market_want: "🛒 중개인 · 살래요",
  market_bid: "🔨 중개인 · 입찰",
  market_outbid: "🔨 중개인 · 입찰 밀림",
  market_new: "🛒 중개인 · 새 물건",
  market_auction: "🔨 중개인 · 경매 전환",
  gold_want: "💰 골드 · 거래 신청",
  request: "📜 의뢰소",
  request_new: "📜 의뢰소 · 새 의뢰",
  talk: "💬 토론방",
  board: "📋 게시판 · 댓글",
  board_notice: "📢 게시판",
  shop: "💎 플래티넘 상점",
  account: "👤 내 계정",
};

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
      await self.registration.showNotification((latest && KIND_TITLE[latest.kind]) || "Sapphire", {
        body: latest ? latest.text : "새 알림이 있어요",
        icon: "/icon-192.png",
        // 상태바 작은 아이콘: 안드로이드는 한 가지 색(모양)만 그려서, 하얀 사파이어 보석 모양 (badge-96.png)
        badge: "/badge-96.png",
        tag: latest ? "alert-" + latest.id : "alert",
        data: { link: (latest && latest.link) || "#/alerts" },
        ...(unread > 1 ? { renotify: false } : {}),
      });
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || "#/alerts";
  const url = self.registration.scope + "?icon=" + ICON_VERSION + link;
  e.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // 홈 화면 웹앱 창(주소에 ?icon=)을 브라우저 탭보다 먼저
      list.sort((a, b) => (b.url.includes("icon=") ? 1 : 0) - (a.url.includes("icon=") ? 1 : 0));
      const c = list[0];
      if (!c) return self.clients.openWindow(url);
      // 열려 있는 화면에 '이 글로 가' 를 보낸다 (main.tsx 가 해시만 바꾼다). navigate 는 안 되는 폰이 있었다 (제작자: 눌러도 그 화면으로 안 감)
      c.postMessage({ type: "open", link });
      try {
        await c.focus();
      } catch (err) {
        return self.clients.openWindow(url);
      }
    })(),
  );
});
