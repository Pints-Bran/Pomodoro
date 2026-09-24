/** Notifications are best effort: no worker, no permission, no notification. */
let registration: ServiceWorkerRegistration | null = null;
if ("serviceWorker" in navigator) {
  // Warmed at load, not on Start: a session restored mid-break can reach the
  // boundary without anyone clicking Start on this page load.
  void navigator.serviceWorker.ready.then((ready) => {
    registration = ready;
  });
}

/** Ask once, and only from a real gesture — browsers reject anything else. */
export function askToNotify(): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "default") return;
  try {
    void Notification.requestPermission().catch(() => {});
  } catch {
    // Older Safari only has the callback form; staying quiet is the right loss.
  }
}

export function notify(title: string, body: string): void {
  if (typeof Notification === "undefined") return;
  // Read fresh every time, so a permission revoked mid-session is honoured.
  if (Notification.permission !== "granted") return;
  const options: NotificationOptions = {
    body,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    // One tag for both boundaries: "Break's over" replaces a "Break time" still
    // on screen rather than stacking under it.
    tag: "still-phase",
  };
  try {
    if (registration) {
      void registration.showNotification(title, options).catch(() => {});
      return;
    }
    // Android Chrome refuses this constructor outright; the worker is the path
    // that matters, this only covers the seconds before it activates.
    void new Notification(title, options);
  } catch {
    // A refused notification must never take the timer down with it.
  }
}
