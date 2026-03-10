// Push notification event handler for Service Worker

self.addEventListener("push", function (event) {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = {
      title: "Whisper Shield",
      body: event.data.text() || "Bạn có tin nhắn mới",
    };
  }

  const options = {
    body: data.body || "Bạn có tin nhắn mới",
    icon: data.icon || "/icons/icon-192x192.png",
    badge: data.badge || "/icons/icon-192x192.png",
    vibrate: [200, 100, 200],
    tag: "whisper-shield-message",
    renotify: true,
    requireInteraction: false,
    data: data.data || {},
    actions: [
      { action: "open", title: "Mở" },
      { action: "close", title: "Đóng" },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title || "Whisper Shield", options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  if (event.action === "close") return;

  const urlToOpen = event.notification.data?.url || "/chat";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes("/chat") && "focus" in client) {
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
