import { expect, type Page, test } from "@playwright/test";

declare global {
  interface Window {
    timeOffset: number;
    activeSounds: number;
    failAudio: boolean;
    audioAttempts: number;
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const originalNow = Date.now;
    // Keep the fake clock across reloads: the app is meant to survive them.
    Object.defineProperty(window, "timeOffset", {
      get: () => Number(sessionStorage.getItem("test.timeOffset") ?? 0),
      set: (value: number) =>
        sessionStorage.setItem("test.timeOffset", String(value)),
    });
    Date.now = () => originalNow() + window.timeOffset;
    window.activeSounds = 0;
    window.audioAttempts = 0;
    window.failAudio = false;
    const createSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      window.audioAttempts++;
      if (window.failAudio) throw new Error("Simulated audio device failure");
      const node = createSource.call(this);
      const start = node.start.bind(node);
      const stop = node.stop.bind(node);
      node.start = (...args) => {
        start(...args);
        window.activeSounds++;
      };
      node.stop = (...args) => {
        stop(...args);
        window.activeSounds--;
      };
      return node;
    };
  });
});

test("work, silent break, resume, pause, stop, and offline history", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()))
      errors.push(message.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.locator("#start").click();
  await expect.poll(() => page.evaluate(() => window.activeSounds)).toBe(1);
  await page.evaluate(() => {
    window.timeOffset += 25 * 60 * 1000;
  });
  await expect(page.locator("body")).toHaveClass("break");
  expect(await page.evaluate(() => window.activeSounds)).toBe(0);
  await expect(page.locator("#total-count")).toHaveText("1");
  await page.evaluate(() => {
    window.timeOffset += 5 * 60 * 1000;
  });
  await expect(page.locator("#cycle")).toHaveText("SESSION 02");
  expect(await page.evaluate(() => window.activeSounds)).toBe(1);
  await page.locator("#pause").click();
  const paused = await page.locator("#timer").textContent();
  await page.evaluate(() => {
    window.timeOffset += 60000;
  });
  await page.waitForTimeout(350);
  await expect(page.locator("#timer")).toHaveText(paused ?? "");
  expect(await page.evaluate(() => window.activeSounds)).toBe(0);
  await page.locator("#start").click();
  await page.evaluate(() => {
    window.timeOffset += 60000;
  });
  await page.locator("#stop").click();
  await expect(page.locator("#timer")).toHaveText("25:00");
  await expect(page.locator(".session")).toHaveCount(2);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".session")).toHaveCount(2);
  await page.locator("#start").click();
  await expect.poll(() => page.evaluate(() => window.activeSounds)).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("audio failure does not crash or retry every timer tick, and resume recovers", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.evaluate(() => {
    window.failAudio = true;
  });
  await page.locator("#start").click();
  await expect(page.locator("#sound-label")).toContainText("Audio unavailable");
  await page.evaluate(() => {
    window.timeOffset += 60000;
  });
  await expect(page.locator("#timer")).toHaveText(/^23:|^24:/);
  expect(await page.evaluate(() => window.audioAttempts)).toBe(1);
  await page.locator("#pause").click();
  await page.evaluate(() => {
    window.failAudio = false;
  });
  await page.locator("#start").click();
  await expect.poll(() => page.evaluate(() => window.activeSounds)).toBe(1);
  expect(errors).toEqual([]);
});

test("malformed session data is filtered safely", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "still.sessions.v1",
      JSON.stringify([
        null,
        { start: "bad", end: 1, seconds: 60, complete: true },
        { start: null, end: 1, seconds: 60, complete: true },
      ]),
    ),
  );
  await page.reload();
  await expect(page.locator(".session")).toHaveCount(1);
});

test("worker upgrades preserve caches belonging to other app scopes", async ({
  page,
}) => {
  // Seed caches on the same origin before the app registers its worker.
  await page.route("**/cache-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>Cache test</title><link rel="icon" href="data:,">',
    }),
  );
  await page.goto("/cache-test");
  await page.evaluate(async () => {
    await caches.open("still-pwa-sibling-release");
    await caches.open(
      `still-pwa-${encodeURIComponent(`${location.origin}/`)}-old`,
    );
  });
  await page.goto("/");
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const names = await page.evaluate(() => caches.keys());
  expect(names).toContain("still-pwa-sibling-release");
  expect(names.some((name) => name.endsWith("-old"))).toBe(false);
});

/** The loop named in the sound label: "♫   Shuffle · Dusk · playing". */
async function playingTrack(page: Page): Promise<string> {
  const label = (await page.locator("#sound-label").textContent()) ?? "";
  const parts = label.split(" · ");
  return parts[0]?.includes("Shuffle") ? (parts[1] ?? "") : (parts[0] ?? "");
}

test("lo-fi track choice switches live and is remembered", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#track")).toHaveValue("shuffle");
  await expect(page.locator("#sound-label")).toContainText("Shuffle");
  expect(await page.locator("#track option").count()).toBeGreaterThan(2);

  await page.locator("#start").click();
  await expect.poll(() => page.evaluate(() => window.activeSounds)).toBe(1);
  const rendered = await page.evaluate(() => window.audioAttempts);

  await page.locator("#track").selectOption("dusk");
  await expect(page.locator("#sound-label")).toContainText("Dusk · playing");
  // The old loop is stopped as the new one starts, so one voice stays audible.
  await expect.poll(() => page.evaluate(() => window.activeSounds)).toBe(1);
  expect(await page.evaluate(() => window.audioAttempts)).toBe(rendered + 1);

  await page.reload();
  await expect(page.locator("#track")).toHaveValue("dusk");
  await expect(page.locator("#sound-label")).toContainText("Dusk");

  await page.evaluate(() =>
    localStorage.setItem("still.track.v1", "no-such-track"),
  );
  await page.reload();
  await expect(page.locator("#track")).toHaveValue("shuffle");
  expect(errors).toEqual([]);
});

test("shuffle moves to another loop mid-session and on the next one", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#track")).toHaveValue("shuffle");

  await page.locator("#start").click();
  await expect.poll(() => page.evaluate(() => window.activeSounds)).toBe(1);
  const first = await playingTrack(page);
  expect(first).not.toBe("");

  await page.evaluate(() => {
    window.timeOffset += 5 * 60 * 1000;
  });
  await expect.poll(() => playingTrack(page)).not.toBe(first);
  // The old loop stops as the new one starts, so the room never goes quiet.
  expect(await page.evaluate(() => window.activeSounds)).toBe(1);

  const second = await playingTrack(page);
  await page.locator("#skip").click();
  await expect(page.locator("body")).toHaveClass("break");
  await page.locator("#skip").click();
  await expect.poll(() => playingTrack(page)).not.toBe(second);
  await expect.poll(() => page.evaluate(() => window.activeSounds)).toBe(1);

  // A named track stays put: shuffling is a choice, not something imposed.
  await page.locator("#track").selectOption("rain");
  const chosen = await playingTrack(page);
  await page.evaluate(() => {
    window.timeOffset += 6 * 60 * 1000;
  });
  await expect(page.locator("#timer")).toHaveText(/^1[89]:/);
  expect(await playingTrack(page)).toBe(chosen);
  expect(errors).toEqual([]);
});

test("skip ends the phase early and still counts the session", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#skip")).toBeDisabled();
  await page.locator("#start").click();
  await expect.poll(() => page.evaluate(() => window.activeSounds)).toBe(1);
  await page.evaluate(() => {
    window.timeOffset += 60000;
  });
  await expect(page.locator("#timer")).toHaveText(/^2[34]:/);

  await page.locator("#skip").click();
  await expect(page.locator("body")).toHaveClass("break");
  await expect(page.locator("#timer")).toHaveText(/^0[45]:/);
  expect(await page.evaluate(() => window.activeSounds)).toBe(0);
  await expect(page.locator(".session")).toHaveCount(1);
  await expect(page.locator(".session").first()).toContainText("Focus skipped");
  // A minute of work is a minute of work, but it is not a finished pomodoro.
  await expect(page.locator("#total-count")).toHaveText("0");
  await expect(page.locator("#today-minutes")).toHaveText("1 min");

  await page.locator("#skip").click();
  await expect(page.locator("#cycle")).toHaveText("SESSION 02");
  await expect(page.locator("#timer")).toHaveText(/^2[45]:/);
  await expect(page.locator("body")).not.toHaveClass("break");
  await expect.poll(() => page.evaluate(() => window.activeSounds)).toBe(1);
  await expect(page.locator(".session")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a running timer keeps counting through a reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator("#start").click();
  await expect.poll(() => page.evaluate(() => window.activeSounds)).toBe(1);
  await page.evaluate(() => {
    window.timeOffset += 10 * 60 * 1000;
  });
  await expect(page.locator("#timer")).toHaveText(/^1[45]:/);

  await page.reload();
  await expect(page.locator("#timer")).toHaveText(/^1[45]:/);
  await expect(page.locator("#cycle")).toHaveText("SESSION 01");
  await expect(page.locator("#pause")).toBeEnabled();
  await expect(page.locator("#start")).toBeDisabled();
  // Autoplay rules hold the music until the page gets a real gesture.
  expect(await page.evaluate(() => window.activeSounds)).toBe(0);
  await expect(page.locator("#sound-label")).toContainText(
    "bring the music back",
  );
  await page.locator("footer").click();
  await expect.poll(() => page.evaluate(() => window.activeSounds)).toBe(1);
  await expect(page.locator("#sound-label")).toContainText("playing");

  // The phase boundary the restored deadline carries still lands on time.
  await page.evaluate(() => {
    window.timeOffset += 15 * 60 * 1000;
  });
  await expect(page.locator("body")).toHaveClass("break");
  await expect(page.locator("#total-count")).toHaveText("1");
  expect(errors).toEqual([]);
});

test("a paused timer reloads paused, not restarted", async ({ page }) => {
  await page.goto("/");
  await page.locator("#start").click();
  await page.evaluate(() => {
    window.timeOffset += 5 * 60 * 1000;
  });
  await page.locator("#pause").click();
  const paused = await page.locator("#timer").textContent();
  expect(paused).toMatch(/^(19|20):/);

  await page.reload();
  await expect(page.locator("#timer")).toHaveText(paused ?? "");
  await expect(page.locator("#start-label")).toHaveText("Resume");
  await page.evaluate(() => {
    window.timeOffset += 10 * 60 * 1000;
  });
  await page.waitForTimeout(350);
  await expect(page.locator("#timer")).toHaveText(paused ?? "");
  expect(await page.evaluate(() => window.activeSounds)).toBe(0);
});

test("a timer left running for hours starts a fresh sitting", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "still.timer.v1",
      JSON.stringify({
        phase: "break",
        state: "running",
        deadline: Date.now() - 3 * 60 * 60 * 1000,
        remaining: 0,
        round: 6,
        startedAt: Date.now() - 4 * 60 * 60 * 1000,
      }),
    ),
  );
  await page.reload();
  await expect(page.locator("#timer")).toHaveText("25:00");
  await expect(page.locator("#cycle")).toHaveText("SESSION 01");
  await expect(page.locator("#stop")).toBeDisabled();
  await expect(page.locator(".session")).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("still.timer.v1")),
  ).toBe(null);
});

test("a malformed timer snapshot is ignored", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem("still.timer.v1", '{"phase":"nap","state":"zoom"'),
  );
  await page.reload();
  await expect(page.locator("#timer")).toHaveText("25:00");
  await expect(page.locator("#cycle")).toHaveText("SESSION 01");
  expect(errors).toEqual([]);
});
