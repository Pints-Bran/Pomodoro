import { defineConfig } from "@playwright/test";

// Playwright propagates FORCE_COLOR to workers. Preserve a no-color preference
// without passing contradictory Node color settings to those processes.
if (process.env.NO_COLOR !== undefined) {
  delete process.env.NO_COLOR;
  process.env.FORCE_COLOR = "0";
}

export default defineConfig({
  testDir: "./tests",
  // The desktop suite launches Electron and has its own config.
  testIgnore: "desktop/**",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: process.platform === "darwin" ? "chrome" : undefined,
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "python3 -m http.server 4173 --bind 127.0.0.1 --directory dist",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
