# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Still" — a zero-dependency TypeScript Pomodoro PWA. 25 minutes of focus with
synthesized lo-fi music, 5 silent minutes, repeating indefinitely, plus a
localStorage focus journal. No runtime dependencies, no bundler, no framework,
no audio files, no network calls, no fonts fetched from a CDN.

## Commands

```sh
npm ci
npm start          # build + serve dist/ on http://localhost:8080 (no watch: re-run to rebuild)
npm run build      # typecheck, compile, copy static assets into dist/
npm run check      # typecheck + Biome lint/format/import-order; warnings fail (this is what CI runs)
npm run lint:fix   # apply Biome's safe fixes — run before finishing any change
npm test           # build, then Playwright against dist/
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

## Build pipeline

`scripts/build.ts` is the whole build. It compiles two tsconfigs, copies
`index.html`, `style.css`, `manifest.webmanifest` and `icons/` into `dist/`,
then hashes every shipped asset and substitutes the digest for the
`__BUILD_VERSION__` token in `dist/sw.js`, so each changed release gets a fresh
service-worker cache without a manual version bump.

`index.html` is a **build input**, not a page to open directly: it loads the
compiled `app.js`/`pwa.js`, and PWA behaviour needs an http(s) origin. Always
serve `dist/`.

**Adding a new source or static file means touching three lists:** the copy list
and the `assets` hash list in `scripts/build.ts`, and `ASSETS` in `src/sw.ts`.
Miss the last one and the file is simply absent offline.

## TypeScript layout

Three compilation domains, because browser, service-worker and Node code need
different `lib`/`types`. `tsconfig.json` is a solution file with no files of its
own; every source file belongs to exactly one project:

| Config | Covers | Notes |
| --- | --- | --- |
| `tsconfig.app.json` | `src/**` except `sw.ts` | `lib: DOM`, `types: []`, emits to `dist/` |
| `tsconfig.worker.json` | `src/sw.ts` | extends the app config, swaps in `lib: WebWorker` |
| `tsconfig.tools.json` | `scripts/`, `tests/`, `playwright.config.ts` | `types: node`, `noEmit`, `erasableSyntaxOnly` |

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

### `src/notify.ts` — the break-over notification

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

Three gates decide whether the break→work boundary says anything, and each earns
its place. `document.hidden` — a visible page already has the overlay lifting
off it, and the `visibilitychange → tick()` path sees `hidden === false` by the
time it runs, so returning to the tab settles a boundary silently. `restoring` —
a boundary found while `restoreTimer()` catches up belongs to a past visit.
`NOTIFY_GRACE` (90 s) — a hidden tab's interval is throttled to roughly a
minute, so a live boundary lands well inside it, while "your break ended eleven
minutes ago" is noise. Exactly-once falls out of `tick()` holding the last
break→work crossing in a **local** `breakEnded`, so however many boundaries one
catch-up pass settles, at most one notification goes out; the `tag` on the
notification is the second line of defence.

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
  `window.pageHidden`.
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

## Conventions

Biome with the recommended preset, 2-space indent, `--error-on-warnings`.
Comments are sparse and explain **why** a non-obvious choice was made, not what
the line does; match that density. Prose in the UI and in comments is calm and
lowercase-ish in tone — follow the surrounding voice rather than introducing
exclamation marks or emoji.

`dist/` is generated; never edit it or commit it.

## Deploy

`.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages on every push
to `main`, running `npm run check` and `npm test` first (CI installs the bundled
Chromium, since `playwright.config.ts` only pins the `chrome` channel on macOS).
