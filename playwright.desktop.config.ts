import { defineConfig } from "@playwright/test";

// Launches the Electron shell against the built dist/ and dist-desktop/. Kept
// out of CI: it needs a real macOS window server and it takes the screen.
export default defineConfig({
  testDir: "./tests/desktop",
  // One app, one window and one single-instance lock at a time.
  workers: 1,
});
