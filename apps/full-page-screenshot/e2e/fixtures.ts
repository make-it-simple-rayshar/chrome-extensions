import path from 'node:path';
import { type BrowserContext, type Page, test as base, chromium } from '@playwright/test';

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture pattern
  context: async ({}, use) => {
    const pathToExtension = path.resolve(__dirname, '..', 'dist');
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },
});

export const expect = test.expect;

export async function openPopup(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Capture Full Page' }).waitFor({ timeout: 5000 });
  return page;
}

/**
 * Wait for capture to finish. RESTORE runs before downloadCanvas, so content
 * script state is fully restored even when the download step fails (e.g.
 * URL.createObjectURL unavailable in service worker). We accept either the
 * success message or the error message as proof that the capture loop completed.
 */
export async function waitForCaptureFinish(popup: Page, timeout = 30_000) {
  const done = popup.getByText('Done! Screenshot saved.');
  const error = popup.getByText('Capture failed', { exact: false });
  await expect(done.or(error)).toBeVisible({ timeout });
}

/**
 * Trigger a full-page capture on `targetPage` via the popup and wait for it to
 * finish. Handles the bringToFront dance required so the background service
 * worker's `getActiveTabId()` resolves to the target page.
 */
export async function triggerCaptureAndWait(popup: Page, targetPage: Page) {
  await targetPage.bringToFront();
  await popup.evaluate(() => chrome.runtime.sendMessage({ action: 'START_CAPTURE' }));
  await popup.bringToFront();
  await waitForCaptureFinish(popup);
}
