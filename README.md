# Still — Pomodoro

A TypeScript Pomodoro PWA with original lo-fi music and a local focus journal.

## Develop and build

Requires Node.js 22.18+ and Python 3 (for the local preview server).

```sh
npm ci
npm start
```

Open `http://localhost:8080`. After editing source files, restart the command to rebuild.

- `npm run typecheck` checks browser, service-worker, and build-tool code with strict TypeScript.
- `npm run build` compiles TypeScript and copies static assets into `dist/`.
- `npm run format` formats supported source and configuration files with Biome.
- `npm run lint` runs Biome alone; `npm run lint:fix` applies its safe fixes.
- `npm run check` checks TypeScript types plus Biome lint, import ordering, and formatting (warnings fail the check).
- `npm test` builds and runs browser regression tests for work/break transitions, skipping a phase, timer restore across reloads, offline audio and history, audio failure recovery, invalid saved data, the break rest view, break-over notifications, and cache isolation. Tests use installed Google Chrome on macOS; on other platforms run `npx playwright install chromium` once first.

Edit `src/app.ts` for the timer and journal, `src/audio.ts` for the music, `src/pwa.ts` for installation, and `src/sw.ts` for offline caching. `src/dom.ts` provides runtime-checked, typed element lookup. Saved JSON is validated before use. Browser and worker types have separate compiler configurations.

JavaScript in `dist/` is generated for the browser; do not edit it. The HTML entry point is a build input: serve the compiled `dist/` directory rather than opening the source HTML directly.

## Features

- Start: 25 minutes of focus with built-in, original synthesized lo-fi music.
- Break: 5 minutes of silence, followed automatically by another focus session, indefinitely.
- Pause freezes the timer and silences audio. Resume continues the session. Stop resets the timer and records any partial focus time.
- Skip ends the current phase early: from focus it records the time you did sit through and moves straight to the break; from a break it starts the next focus session.
- The session counter on the card advances with every finished focus phase, whether the clock ran it out or you skipped it.
- When the break starts, a full-screen rest view takes over the page and counts it down; when the break ends with Still in the background, a system notification asks you to minimise it and start the next 25.
- Completed focus sessions and stopped partial sessions are saved in localStorage. The journal shows the latest 20; statistics include all saved sessions.
- Volume controls this app's music. The app cannot mute other Mac applications.

Keep this tab open and your Mac awake for uninterrupted music and timing. Browsers may suspend background audio or timers; when the page runs again it catches up using elapsed wall-clock time. Reloading does not reset the active timer: the running or paused clock is saved in localStorage and picked back up, including any phase boundary that passed while the page was away. Because browsers do not allow sound on a fresh page load, a restored session counts down silently until your first click or key press brings the music back. A clock left more than 30 minutes past its deadline is treated as a closed app rather than a reload, and a fresh session starts instead. Private browsing or clearing browser data can remove history. Use the same site address consistently to retain access to its local history.

## Install on mobile (PWA)

Run `npm run build`, then publish the contents of `dist/`, including `icons`, to an HTTPS static website (for example GitHub Pages, Netlify, or your existing host). Relative URLs support deployment in a subdirectory. No server-side code is needed. Configure your host’s build command as `npm ci && npm run build` and publish directory as `dist`. A `file://` URL or plain HTTP LAN address cannot provide mobile PWA installation/offline support.

- **iPhone/iPad:** visit the HTTPS URL, open Share → Add to Home Screen, and enable Open as Web App if offered.
- **Android:** visit the HTTPS URL in Chrome and tap **Install app** in Still when available, or use the browser menu → Install app / Add to Home Screen.
- Launch **Still** from your home screen. After the first online visit finishes offline setup, its timer, generated music, and journal work without a connection.

For local desktop testing, run `npm start` in this directory and open `http://localhost:8080`. Localhost is allowed for development; visiting your Mac’s HTTP IP address from a phone is not equivalent.

The PWA opens in a standalone window and supports display cutouts and home indicators. All app assets and icons are cached locally; fonts use the system fallback with no external requests. Installing does not grant native background execution: keep the app visible and the device awake for reliable timed music. Mobile operating systems may suspend background or locked-screen audio. History and the saved timer are per browser/app storage and origin; installing on iOS may use separate storage from the browser.

Each build automatically generates a service-worker cache version from the compiled app and static assets. A new worker caches the full release and waits until existing app windows close before activating, so updates do not reload an active timer.
