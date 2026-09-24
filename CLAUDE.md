# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Still" — a zero-dependency TypeScript Pomodoro PWA. 25 minutes of focus with
synthesized lo-fi music, 5 silent minutes (30 after every fourth session),
repeating indefinitely, plus sourced quotes that change with each phase and a
localStorage focus journal. No runtime dependencies, no bundler, no framework,
no audio files, no network calls, no fonts fetched from a CDN. An optional
Electron shell in `desktop/` runs the same `dist/` as a macOS app, for the one
thing a web page cannot do: bring its own window to the front when a break
starts. Electron is a dev dependency; the web build ships none of it.

## Commands

```sh
npm ci
npm start          # build + serve dist/ on http://localhost:8080 (no watch: re-run to rebuild)
npm run build      # typecheck, compile, copy static assets into dist/
npm run check      # typecheck + Biome lint/format/import-order; warnings fail (this is what CI runs)
npm run lint:fix   # apply Biome's safe fixes — run before finishing any change
npm test           # build, then Playwright against dist/
npm run desktop    # build dist/ + dist-desktop/, launch the Electron shell
npm run package    # same, then electron-builder → release/mac*/Still.app
npm run test:desktop  # build both, then the Electron suite (local macOS only)
```

Single test or a subset:

```sh
npm run build && npx playwright test -g "skip ends the phase early"
npx playwright test --headed --debug -g "reload"
```

`npm test` exists because the suite runs against the **built** `dist/`, not the
sources. Running `npx playwright test` alone silently tests the previous build.

Requires Node 22.18+ and Python 3 (the preview and test servers are
`python3 -m http.server`). Playwright uses installed Google Chrome on macOS; on
other platforms run `npx playwright install chromium` once.

Electron 44 fetches its binary on first launch, not at `npm ci`. VS Code's
extension host exports `ELECTRON_RUN_AS_NODE=1` to child processes, which makes
Electron start as plain Node ("does not provide an export named
BrowserWindow"); `npm run desktop` and the desktop suite unset it.

## Build pipeline

`scripts/build.ts` is the whole build. It compiles two tsconfigs, copies
`index.html`, `style.css`, `manifest.webmanifest` and `icons/` into `dist/`,
then hashes every shipped asset and substitutes the digest for the
`__BUILD_VERSION__` token in `dist/sw.js`, so each changed release gets a fresh
service-worker cache without a manual version bump.

`index.html` is a **build input**, not a page to open directly: it loads the
compiled `app.js`/`pwa.js`, and PWA behaviour needs an http(s) origin. Always
serve `dist/`.

`npm run build:desktop` adds `tsc -p tsconfig.desktop.json`, emitting the main
process and preload into `dist-desktop/`. The packaged app contains only
`dist/`, `dist-desktop/` and `package.json`.

**Adding a new source or static file means touching three lists:** the copy list
and the `assets` hash list in `scripts/build.ts`, and `ASSETS` in `src/sw.ts`.
Miss the last one and the file is simply absent offline.

## TypeScript layout

Four compilation domains, because browser, service-worker, Node and Electron code need
different `lib`/`types`. `tsconfig.json` is a solution file with no files of its
own; every source file belongs to exactly one project:

| Config | Covers | Notes |
| --- | --- | --- |
| `tsconfig.app.json` | `src/**` except `sw.ts` | `lib: DOM`, `types: []`, emits to `dist/` |
| `tsconfig.worker.json` | `src/sw.ts` | extends the app config, swaps in `lib: WebWorker` |
| `tsconfig.tools.json` | `scripts/`, `tests/`, both Playwright configs | `types: node`, `noEmit`, `erasableSyntaxOnly` |
| `tsconfig.desktop.json` | `desktop/**` | `NodeNext`, `types: node`, emits to `dist-desktop/`; `lib: DOM` only because `electron.d.ts` extends `HTMLElement` |

`strict` plus `noUncheckedIndexedAccess`, `noUnusedLocals`,
`noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`. The
`?? 0` guards all through `audio.ts` are `noUncheckedIndexedAccess`, not
defensive habit — don't "clean them up".

## Architecture

### `src/app.ts` — timer, journal, audio orchestration

One module-scope state machine (`phase`, `state`, `remaining`, `deadline`,
`round`, `startedAt`) driven by `tick()` on a 250 ms interval plus
`visibilitychange` and `pageshow`.

The clock is **wall-clock deadline based, never a decrementing counter.**
`tick()` loops `while (now >= deadline)` and settles every phase boundary that
passed, so a throttled background tab or a reload catches up in one pass and
still records the sessions it owes. Any code that changes phase must go through
this model rather than subtracting from `remaining`.

The long break lives entirely in `duration()`. `longBreak()` is
`phase === "break" && round % LONG_EVERY === 0`: during a break, `round` is
still the session that just ended, because `round++` only happens at
break→work. Every place that sets a clock already asks `duration()`: the
`tick()` deadline, Skip's `remaining`, the restore clamp and the progress ring.
So catch-up, Skip and reload need no long-break code of their own, and the
snapshot shape did not change. Skipped sessions count toward the four, because
they advance `round`. Stop resets it.

`render()` is the single place that writes to the DOM; handlers mutate state and
call it. Element lookup goes through the `elements` map and the `$()` accessor,
backed by `src/dom.ts`'s runtime-checked `getElement`, which **throws at module
load** if an id or its type is missing. Adding UI therefore means editing
`index.html` and the `elements` map together — except ids that exist purely as
ARIA targets (`break-heading`), which stay out of the map.

`render()` also drives the break rest view, `#break-overlay`, derived from
`phase === "break" && state !== "idle"` — never toggled from a handler, so the
two places phase can change (the `tick()` loop and Skip) both get it for free,
and pausing a break keeps it up with a frozen clock. Its countdown is written
from the same `display` string as `#timer`, so the two cannot drift. Only the
non-idempotent part of the transition — `hidden`, `inert` on `#app`, body
overflow, moving focus — is edge-triggered through `overlayOpen`. `#app` going
`inert` is why `#announcement` sits outside `<main>`: a live region inside an
inert subtree stops announcing. `#break-skip` and `#break-stop` share the named
`skipPhase`/`stopTimer` functions with the main controls rather than
synthesising a click on a button that is at that moment behind `inert`.

Quotes are edge-triggered in `render()` too, on `quoteKey = phase:round`. The
clock, Skip, Stop, restore and first load all get a fresh one without calling
anything. A work key writes `#quote-*` on the card, and a break key writes
`#break-quote-*` on the overlay. `lastQuote` per phase is handed to
`pickQuote()`, so the same quote never shows twice running.

The last thing `render()` does is `reportStatus({ phase, state, clock })` from
`src/desktop.ts`, a no-op outside the desktop shell. It deduplicates, so the
shell hears about once a second rather than four times.

### localStorage

| Key | Holds |
| --- | --- |
| `still.sessions.v1` | the focus journal, newest first |
| `still.track.v1` | chosen music track id, or `shuffle` |
| `still.timer.v1` | the live clock, so a reload does not lose the session |

Every read is validated by a type guard (`isFocusSession`, `isTimerSnapshot`)
and bad entries are dropped, never trusted — stored JSON is user-editable input.
Keys are version-suffixed; bump the suffix when a shape changes incompatibly.
Each storage access sits in its own `try`/`catch` so a full or disabled store
degrades to a working timer with a message in `#storage-message`, and so a
corrupt session list cannot cost the user their track preference.

Timer restore (`restoreTimer()`) resumes a running clock against the saved
deadline, or a paused one at the same digits. Past `RESUME_GRACE` (30 min beyond
the saved deadline) it discards the snapshot instead: the app was closed, not
reloaded, and catching up would invent focus nobody sat through.

Browser autoplay rules forbid sound on a fresh page load, so a restored run
counts down immediately but silently with `needsGesture` set; the first
`pointerdown`/`keydown` calls `resumeAudio()` and the loop returns without
disturbing the countdown. This is unavoidable, not a bug to fix.

### `src/audio.ts` — synthesized music

`TRACKS` is `as const satisfies readonly Track[]`; `findTrack()` falls back to
`DEFAULT_TRACK` for unknown ids (ids: `still`, `dusk`, `rain`, `drift`).
`makeMusic()` renders one seamless PCM `AudioBuffer` per track — keys, bass,
melody, kick/snare/hat, a one-pole lowpass for warmth, `tanh` soft clip and
vinyl hiss. Rendering is expensive, so buffers are memoized per `AudioContext`
in `app.ts`'s `buffers` map.

One pass of a progression is about thirteen seconds, which is short enough to
grate over 25 minutes, so a loop is `PASSES` passes of it (40 s) with the bass
placement, melody notes, key voicing and a drum-free bar varying pass to pass.
That costs samples, so loops render at a fixed `RATE` of 32 kHz rather than a
device rate that may be 96 kHz, and the oscillators read a sine table instead of
calling `Math.sin` per sample; the browser resamples on playback. Together those
keep a render near 130 ms — it happens on the main thread, on Start and on every
shuffle change, so **keep it there**: a couple of seconds of blocking is what
the earlier `Math.sin`-per-sample version cost at 96 kHz, and the timer tests
time out long before a user would complain.

The track menu's first entry is `SHUFFLE`, and it is the default: `app.ts`
keeps `choice` (what the menu holds) apart from `trackId` (what is sounding).
When shuffling, `shuffleMusic()` moves to another loop every `SHUFFLE_EVERY`,
and `shuffleAt = 0` — set on reset and whenever a work phase begins — means
"change as soon as work is running", so no two sessions open on the same loop.
`pickTrack()` never returns the loop already playing.

Playback is one `voice` = a looping `AudioBufferSourceNode` plus its **own**
fade `GainNode` under the master gain, which is what lets `crossfadeTo()` swap
loops without clicking mid-phrase, for both a menu change and a shuffle change.
Music plays only during `work`; `silence()` runs on break, pause and stop.

`audioFailed` is a latch: without it a broken audio device would retry
`playMusic()` four times a second. It clears only on an explicit Start click,
and a test asserts exactly one attempt per failure.

### `src/quotes.ts` — focus and rest quotes

`FOCUS_QUOTES` and `REST_QUOTES` hold only quotes with a traceable source,
named in a comment above each entry, because most circulating "motivation
quotes" are misattributed. Add to the lists; never paraphrase an entry, and
never add one you cannot source.

### `src/notify.ts` — the phase notifications

Permission is asked once from the Start click (`askToNotify()`, beside
`ensureAudio()`) and **never at module load** — browsers punish that, and Start
is the gesture already in hand. `notify()` re-reads `Notification.permission`
every call so a mid-session revoke is honoured, prefers
`registration.showNotification()` because Android Chrome refuses the
`new Notification()` constructor outright, and swallows every failure: a refused
notification must not take the timer down with it. The registration handle is
warmed from `navigator.serviceWorker.ready` at load, since a session restored
mid-break can reach the boundary with nobody ever clicking Start; `pwa.ts` still
owns `register()`.

Both boundaries notify: "Break time" (or "Long break") when work ends, and
"Break's over" when the break does. The first used to stay quiet on the theory that the rest view was
already waiting, but it opens inside a window nobody is looking at, and that is
the whole problem. Three gates decide whether a boundary says anything, and
each earns its place. Nobody watching, `document.hidden || !document.hasFocus()`:
a focused page has the overlay changing right in front of it, and a visible
window left behind another app is not hidden, only unfocused. Chrome only
reports hidden for a background tab, a minimized window or full occlusion, and
Electron's `backgroundThrottling: false` keeps `hidden` false forever. `restoring`:
a boundary found while `restoreTimer()` catches up belongs to a past visit.
`NOTIFY_GRACE` (90 s): a hidden tab's interval is throttled to roughly a minute,
so a live boundary lands well inside it, while "your break ended eleven minutes
ago" is noise. Exactly-once falls out of `tick()` holding the last crossing in
either direction in a **local** `crossedAt`, and the phase it began is `phase`.
However many boundaries one catch-up pass settles, at most one notification goes
out. The shared `still-phase` tag is the second line of defence, and it lets
"Break's over" replace a "Break time" still on screen.

`sw.ts`'s `notificationclick` focuses the first window within this worker's
scope (same isolation stance as the caches) and opens one if none is left.

### `src/sw.ts` + `src/pwa.ts` — offline and install

Cache names are namespaced `still-pwa-${encodeURIComponent(registration.scope)}-<hash>`
because Cache Storage is shared across an origin; activation deletes only keys
with this scope's prefix, so a sibling app deployed to the same origin survives
(there is a regression test for this). The worker deliberately omits
`skipWaiting()` — an update waits for existing windows to close so it never
reloads a running timer. Fetch is cache-first within scope, with `index.html` as
the navigation fallback.

All URLs are relative (`./`) so the app works from a GitHub Pages subdirectory.

Inside the desktop shell `pwa.ts` hides the install card and never registers
the worker. The files are already local, and a cache-first worker would keep
serving the previous release after an app update. `notify.ts` therefore falls
through to the `new Notification()` constructor, which Electron shows natively.

### `desktop/` — the macOS shell

`preload.cts` exposes one call, `stillDesktop.status()`, over
`ipcRenderer.send`. It is CommonJS because sandboxed preloads cannot be ESM.
`main.ts` validates every message (`isStatus`, the same stance as the storage
guards) and derives the window from it exactly as `render()` derives the
overlay: `phase === "break" && state !== "idle"`. When that rises, `takeOver()`
restores, shows, maximizes, steals focus and bounces the Dock. When it falls,
`stepAside()` unmaximizes (only a maximize it took itself) and minimizes,
unless the new state is idle, since Stop means the user is right there.
`setAlwaysOnTop(…, "floating")` follows a *running* break only, so a paused one
doesn't pin itself over everything. The floating level is also what keeps the
window visible when macOS cooperative activation refuses the focus steal. A
`powerSaveBlocker` (`prevent-app-suspension`) is held while running, since App
Nap would stall the silent break's timers. The tray is a title-only menu bar
clock (`12:34 · Focus`) built from the same `display` string.

The page is served from `still://app/`, a privileged custom scheme rather than
`file://`, so it gets one stable secure origin. The handler guards path
traversal and adds the CSP header there, not in `index.html`, so the web build
is untouched. `img-src data:` is for the select arrow inlined in `style.css`.
Only the `notifications` permission is granted. Closing the window hides it,
because the timer lives in the page, and only Quit ends it. A single-instance
lock stops two timers fighting over one localStorage. `userData` is set
explicitly to `Still` or `Still (dev)`, so a dev run never touches the installed
app's journal or lock. Open at Login is switched on once, on the first packaged
launch (a `login-item-offered` marker), and is the tray checkbox's after that.
It is disabled in dev, where it would register the bare Electron binary.

## Tests

`tests/app.spec.ts`, one file, Playwright, viewport **390×844** (mobile — layout
assertions assume it, including a no-horizontal-scroll check). `webServer`
serves `dist/` on port 4173 with `reuseExistingServer: false`.

Four fixtures in `beforeEach` via `addInitScript` do all the heavy lifting:

- **Fake clock.** `Date.now` is offset by `window.timeOffset`, which is a
  property backed by `sessionStorage` precisely so the offset survives
  `page.reload()` — the reload-continuity tests depend on that. Advance time with
  `window.timeOffset += ms`, then assert; never `waitForTimeout` for real minutes.
- **Audio spy.** `AudioContext.prototype.createBufferSource` is patched to count
  `activeSounds` (started minus stopped) and `audioAttempts`, and to throw when
  `failAudio` is set.
- **Visibility.** Playwright cannot hide a page, so `document.hidden` and
  `document.visibilityState` are shadowed by configurable accessors reading
  `window.pageHidden`. `document.hasFocus()` reads `window.pageFocused` (default
  `true`), so a test can leave a visible page behind another app.
- **Notification spy.** Both `ServiceWorkerRegistration.prototype.showNotification`
  and the `Notification` constructor are stubbed — the second so the spy never
  races worker activation — recording into `window.notifications`.
  `permissionRequests` counts asks and `notificationPermission` lets a test
  refuse. No real `grantPermissions`: the stub owns that dimension.

Two traps. Several tests assert `body`'s **exact** className
(`toHaveClass("break")`), so never add a second class to `<body>` — put UI state
on the element it belongs to. And nothing inside `<main>` is clickable during a
break, because the overlay covers it and `#app` is `inert`, so a test acting
then must target `#break-skip`/`#break-stop`. The overlay is deliberately
un-animated: Playwright waits for a stable bounding box before clicking.

Timer text assertions use regexes (`/^1[45]:/`) or a captured previous value —
real time passes between action and assertion, so exact strings are flaky.
Several tests also assert `pageerror`/console warnings are empty; keep them that way.

`tests/desktop/desktop.spec.ts` has its own `playwright.desktop.config.ts`
(`workers: 1`, one app and one lock at a time). The main config ignores it,
because it needs a real macOS window server and it takes the screen, so CI
never runs it. It launches the shell with `_electron`, clears localStorage,
reloads, then swaps `Date.now` for an offset clock after load. That works
because `app.ts` reads `Date.now` on every call. It asserts window state through
`app.evaluate(({ BrowserWindow }) => …)`.

## Conventions

Biome with the recommended preset, 2-space indent, `--error-on-warnings`.
Comments are sparse and explain **why** a non-obvious choice was made, not what
the line does; match that density. Prose in the UI and in comments is calm and
lowercase-ish in tone — follow the surrounding voice rather than introducing
exclamation marks or emoji.

`dist/`, `dist-desktop/` and `release/` are generated; never edit or commit them.

## Deploy

`.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages on every push
to `main`, running `npm run check` and `npm test` first (CI installs the bundled
Chromium, since `playwright.config.ts` only pins the `chrome` channel on macOS).
The desktop app is built locally with `npm run package` and is not published.
