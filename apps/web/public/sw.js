// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

// Service worker KanCRM: riceve le notifiche Web Push e le mostra.
self.addEventListener("push", (event) => {
  let data = { title: "KanCRM", body: "" };
  try {
    data = event.data ? event.data.json() : data;
  } catch {
    data.body = event.data ? event.data.text() : "";
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "KanCRM", {
      body: data.body,
      // Il file che c'è davvero: `/icon.svg` non è mai esistito, e l'avviso
      // usciva senza immagine (su macOS con l'icona di Chrome al suo posto).
      icon: "/keelops-favicon.svg",
      badge: "/keelops-favicon.svg",
      lang: "it",
    }),
  );
});

// Click sulla notifica: porta in primo piano l'app (o la apre).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => "focus" in client);
      if (existing) return existing.focus();
      return self.clients.openWindow("/");
    }),
  );
});
