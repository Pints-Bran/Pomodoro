import { expect, test } from "@playwright/test";

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
    window.timeOffset = 0;
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
  await expect(page.locator("#cycle")).toHaveText("ROUND 02");
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
