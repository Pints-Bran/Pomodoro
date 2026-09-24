import { existsSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  net,
  powerSaveBlocker,
  protocol,
  session,
  Tray,
} from "electron";

/** What the page reports from render(); the same shape as src/desktop.ts. */
interface Status {
  phase: "work" | "break";
  state: "idle" | "running" | "paused";
  clock: string;
}

function isStatus(value: unknown): value is Status {
  if (typeof value !== "object" || value === null) return false;
  const status = value as Record<string, unknown>;
  return (
    (status.phase === "work" || status.phase === "break") &&
    (status.state === "idle" ||
      status.state === "running" ||
      status.state === "paused") &&
    typeof status.clock === "string" &&
    /^\d{2,}:\d{2}$/.test(status.clock)
  );
}

const SCHEME = "still";
const ORIGIN = `${SCHEME}://app`;
const here = dirname(fileURLToPath(import.meta.url));

// Set before the instance lock, which lives in this directory: a dev run must
// never share a journal, or a lock, with the installed app.
app.setPath(
  "userData",
  join(app.getPath("appData"), app.isPackaged ? "Still" : "Still (dev)"),
);
// A custom scheme rather than file://, so the page gets one stable, secure
// origin for localStorage and module scripts.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true } },
]);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
/** Whether the rest view is up, as of the last status. */
let resting = false;
/** Whether the window is pinned above other apps, which a paused break is not. */
let pinned = false;
/** Only give back a maximize we took, never one the user chose. */
let maximizedByUs = false;
let blocker: number | null = null;

function show(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** The break begins: come out in front of whatever the user is doing. */
function takeOver(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  maximizedByUs = !window.isMaximized();
  if (maximizedByUs) window.maximize();
  // macOS may refuse the steal since cooperative activation; the floating
  // level set just before still keeps the window above everything else.
  app.focus({ steal: true });
  window.focus();
  app.dock?.bounce("informational");
}

/** The break is over: give the screen back. */
function stepAside(window: BrowserWindow, minimize: boolean): void {
  if (maximizedByUs) window.unmaximize();
  maximizedByUs = false;
  // Stop leaves the window where it is; the user is right there, clicking it.
  if (minimize) window.minimize();
}

/** App Nap would stall the silent break's timers and every boundary after it. */
function keepAwake(on: boolean): void {
  if (on && blocker === null) {
    blocker = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!on && blocker !== null) {
    powerSaveBlocker.stop(blocker);
    blocker = null;
  }
}

function trayTitle({ phase, state, clock }: Status): string {
  if (state === "idle") return "Still";
  if (state === "paused") return `${clock} · Paused`;
  return `${clock} · ${phase === "work" ? "Focus" : "Break"}`;
}

function onStatus(window: BrowserWindow, status: Status): void {
  tray?.setTitle(trayTitle(status), { fontType: "monospacedDigit" });
  // Derived exactly as render() derives the rest view, so the window cannot
  // disagree with the page about whether this is a break.
  const overlay = status.phase === "break" && status.state !== "idle";
  const pin = overlay && status.state === "running";
  if (pin !== pinned) {
    pinned = pin;
    window.setAlwaysOnTop(pin, "floating");
  }
  if (overlay && !resting) takeOver(window);
  else if (!overlay && resting) stepAside(window, status.state !== "idle");
  resting = overlay;
  keepAwake(status.state === "running");
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 420,
    height: 860,
    minWidth: 360,
    minHeight: 600,
    title: "Still",
    backgroundColor: "#172a26",
    show: false,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      // Keeps the 250 ms tick and the music going while the window is covered.
      backgroundThrottling: false,
    },
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });
  // Closing hides: the timer lives in this page, and only Quit should end it.
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  void window.loadURL(`${ORIGIN}/index.html`);
  return window;
}

function createTray(): Tray {
  const icon = new Tray(nativeImage.createEmpty());
  icon.setTitle("Still", { fontType: "monospacedDigit" });
  icon.setToolTip("Still");
  icon.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Still", click: show },
      { type: "separator" },
      {
        label: "Open at Login",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        // A dev run would register the bare Electron binary as a login item.
        enabled: app.isPackaged,
        click: (item) =>
          app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      { type: "separator" },
      { role: "quit", label: "Quit Still" },
    ]),
  );
  return icon;
}

/** On by default, once; after that the menu item is the user's to change. */
function offerLoginItem(): void {
  if (!app.isPackaged) return;
  const marker = join(app.getPath("userData"), "login-item-offered");
  if (existsSync(marker)) return;
  app.setLoginItemSettings({ openAtLogin: true });
  try {
    writeFileSync(marker, "");
  } catch {
    // Offered again next launch, which is the only cost.
  }
}

function start(): void {
  const root = join(app.getAppPath(), "dist");
  protocol.handle(SCHEME, async (request) => {
    const { host, pathname } = new URL(request.url);
    const file = resolve(
      root,
      `.${decodeURIComponent(pathname === "/" ? "/index.html" : pathname)}`,
    );
    const inside = relative(root, file);
    if (
      host !== "app" ||
      !inside ||
      inside.startsWith("..") ||
      isAbsolute(inside)
    )
      return new Response("Not found", { status: 404 });
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    // Everything the page loads is its own, bar the select arrow inlined in
    // style.css. Sent from here rather than a <meta>, which would reach the web
    // build too.
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:",
    );
    return new Response(response.body, { status: response.status, headers });
  });
  const allowed = (permission: string) => permission === "notifications";
  session.defaultSession.setPermissionRequestHandler(
    (_contents, permission, callback) => callback(allowed(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
    allowed(permission),
  );
  ipcMain.on("still:status", (event, value: unknown) => {
    if (!win || event.sender !== win.webContents || !isStatus(value)) return;
    onStatus(win, value);
  });
  offerLoginItem();
  tray = createTray();
  win = createWindow();
}

// Two windows would be two timers fighting over one localStorage.
if (app.requestSingleInstanceLock()) {
  app.on("second-instance", show);
  app.on("activate", show);
  app.on("before-quit", () => {
    quitting = true;
  });
  void app.whenReady().then(start);
} else {
  app.quit();
}
