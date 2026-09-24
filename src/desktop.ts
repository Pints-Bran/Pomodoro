/** What the desktop shell needs to size its window and set its menu bar clock. */
export interface DesktopStatus {
  phase: "work" | "break";
  state: "idle" | "running" | "paused";
  clock: string;
}
interface DesktopBridge {
  status(status: DesktopStatus): void;
}

// Only the Electron shell's preload puts this here; a browser never has it.
const bridge = (window as Window & { stillDesktop?: DesktopBridge })
  .stillDesktop;
export const inDesktop = bridge !== undefined;

let lastSent = "";
/** render() runs four times a second; the shell only hears about real changes. */
export function reportStatus(status: DesktopStatus): void {
  if (!bridge) return;
  const key = `${status.phase} ${status.state} ${status.clock}`;
  if (key === lastSent) return;
  lastSent = key;
  bridge.status(status);
}
