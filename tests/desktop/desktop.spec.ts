import {
  _electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from "@playwright/test";

declare global {
  interface Window {
    timeOffset: number;
  }
}

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  // VS Code's extension host exports ELECTRON_RUN_AS_NODE, and it turns
  // Electron into plain Node.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[0] !== "ELECTRON_RUN_AS_NODE" && entry[1] !== undefined,
    ),
  );
  app = await _electron.launch({ args: ["."], env });
  page = await app.firstWindow();
  // A clock saved by an earlier run would be restored; start from nothing.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // app.ts reads Date.now on every call, so swapping it after load is enough.
  await page.evaluate(() => {
    const realNow = Date.now.bind(Date);
    window.timeOffset = 0;
    Date.now = () => realNow() + window.timeOffset;
  });
});

test.afterEach(async () => {
  await app.close();
});

const windowState = () =>
  app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    return {
      maximized: window?.isMaximized(),
      minimized: window?.isMinimized(),
      onTop: window?.isAlwaysOnTop(),
    };
  });

test("a break takes the screen, and focus gives it back", async () => {
  await page.locator("#start").click();
  expect(await windowState()).toEqual({
    maximized: false,
    minimized: false,
    onTop: false,
  });

  await page.evaluate(() => {
    window.timeOffset += 25 * 60 * 1000;
  });
  await expect(page.locator("#break-overlay")).toBeVisible();
  await expect
    .poll(windowState)
    .toEqual({ maximized: true, minimized: false, onTop: true });

  await page.evaluate(() => {
    window.timeOffset += 5 * 60 * 1000;
  });
  await expect(page.locator("#cycle")).toHaveText("SESSION 02");
  await expect
    .poll(windowState)
    .toEqual({ maximized: false, minimized: true, onTop: false });
  // Off to the Dock at the size it had before the break, not the maximized one.
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getSize(),
    ),
  ).toEqual([420, 860]);
});

test("stopping a break gives the screen back and stays put", async () => {
  await page.locator("#start").click();
  await page.evaluate(() => {
    window.timeOffset += 25 * 60 * 1000;
  });
  await expect.poll(windowState).toMatchObject({ maximized: true });

  await page.locator("#break-stop").click();
  await expect(page.locator("#break-overlay")).toBeHidden();
  await expect
    .poll(windowState)
    .toEqual({ maximized: false, minimized: false, onTop: false });
});

test("a break skipped into while paused is shown but not pinned", async () => {
  await page.locator("#start").click();
  await page.locator("#pause").click();
  await page.locator("#skip").click();
  await expect(page.locator("#break-overlay")).toBeVisible();
  await expect
    .poll(windowState)
    .toEqual({ maximized: true, minimized: false, onTop: false });
});
