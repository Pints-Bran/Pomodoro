import { getElement } from "./dom.js";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}
function isInstallPromptEvent(event: Event): event is InstallPromptEvent {
  return (
    "prompt" in event &&
    typeof event.prompt === "function" &&
    "userChoice" in event
  );
}
(() => {
  const card = getElement("install-card", HTMLElement);
  const button = getElement("install-app", HTMLButtonElement);
  const help = getElement("install-help", HTMLElement);
  const status = getElement("offline-status", HTMLElement);
  const standalone = window.matchMedia("(display-mode: standalone)");
  const isInstalled = () =>
    standalone.matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  let installPrompt: InstallPromptEvent | null = null;
  function updateInstallUI() {
    card.hidden = isInstalled();
    button.hidden = !installPrompt || isInstalled();
    help.textContent = ios
      ? "To install: open the Share menu, then choose Add to Home Screen. Enable Open as Web App if shown."
      : installPrompt
        ? "Add Still to your home screen for offline focus."
        : "Use your browser menu’s Install app or Add to Home Screen option when available.";
  }
  if (!window.isSecureContext || !/^https?:$/.test(location.protocol)) {
    card.hidden = false;
    help.textContent =
      "To install on your phone, open Still from its HTTPS website. Installation is unavailable when opened as a local file.";
    return;
  }
  updateInstallUI();
  window.addEventListener("beforeinstallprompt", (event) => {
    if (!isInstallPromptEvent(event)) return;
    event.preventDefault();
    installPrompt = event;
    updateInstallUI();
  });
  button.addEventListener("click", async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    button.hidden = true;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      status.textContent = "Use your browser menu to install Still.";
    }
    updateInstallUI();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    card.hidden = true;
  });
  standalone.addEventListener("change", updateInstallUI);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        status.textContent = "Ready to use offline.";
      })
      .catch(() => {
        status.textContent =
          "Offline setup could not finish. Reopen the app online to try again.";
      });
  }
})();
