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

    // Polyfill URL.createObjectURL/revokeObjectURL — removed in Chromium 145+ service workers.
    // The background's downloadCanvas() calls:
    //   blob = await canvas.convertToBlob()
    //   url = URL.createObjectURL(blob)
    //   chrome.downloads.download({ url })
    // We patch convertToBlob to stash a data URL on the blob, then createObjectURL reads it.
    await background.evaluate(() => {
      if (typeof URL.createObjectURL === 'function') return;

      const origConvertToBlob = OffscreenCanvas.prototype.convertToBlob;
      OffscreenCanvas.prototype.convertToBlob = async function (
        ...args: Parameters<OffscreenCanvas['convertToBlob']>
      ) {
        const blob = await origConvertToBlob.apply(this, args);
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const dataUrl = `data:${blob.type};base64,${btoa(binary)}`;
        (blob as Blob & { __dataUrl: string }).__dataUrl = dataUrl;
        return blob;
      };

      URL.createObjectURL = (obj: Blob | MediaSource): string => {
        return (obj as Blob & { __dataUrl?: string }).__dataUrl ?? '';
      };
      URL.revokeObjectURL = (): void => {};
    });

    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },
});

export const expect = test.expect;

export async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Capture Full Page' }).waitFor({ timeout: 5000 });
  return page;
}

/**
 * Installs a message recorder on the popup page that captures all
 * chrome.runtime.onMessage events into window.__captureMessages.
 * Must be called before triggering capture so no messages are missed.
 */
export async function installMessageRecorder(popup: Page): Promise<void> {
  await popup.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__captureMessages = [] as Record<string, unknown>[];
    chrome.runtime.onMessage.addListener((msg: Record<string, unknown>) => {
      (w.__captureMessages as Record<string, unknown>[]).push({ ...msg });
    });
  });
}

/**
 * Returns the list of message objects recorded by installMessageRecorder.
 */
export async function getRecordedMessages(popup: Page): Promise<Record<string, unknown>[]> {
  return popup.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return (w.__captureMessages as Record<string, unknown>[]) ?? [];
  });
}

/**
 * Returns just the action strings from recorded messages.
 */
export async function getRecordedActions(popup: Page): Promise<string[]> {
  const messages = await getRecordedMessages(popup);
  return messages.map((m) => m.action as string);
}

/**
 * Opens a target page, opens the popup, installs a message recorder,
 * then triggers a capture. The target page is kept in the foreground
 * during capture because chrome.tabs.captureVisibleTab() requires
 * the target tab to be the visible one.
 */
export async function triggerCapture(
  context: BrowserContext,
  extensionId: string,
  targetUrl: string,
): Promise<{ targetPage: Page; popup: Page }> {
  const targetPage = await context.newPage();
  await targetPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  const popup = await openPopup(context, extensionId);

  // Install message recorder before triggering capture so we don't miss fast completions
  await installMessageRecorder(popup);

  // Make the target page the active and visible Chrome tab.
  // It must stay in the foreground during capture because
  // chrome.tabs.captureVisibleTab() captures whatever is visible.
  await targetPage.bringToFront();

  // Send START_CAPTURE from popup context — background resolves active tab as the target page.
  // Playwright can evaluate on non-active pages, so this works even though popup is in background.
  await popup.evaluate(() => chrome.runtime.sendMessage({ action: 'START_CAPTURE' }));

  return { targetPage, popup };
}

/**
 * Waits until the message recorder has seen CAPTURE_COMPLETE or CAPTURE_ERROR.
 * Returns the final action name.
 */
export async function waitForCaptureEnd(
  popup: Page,
  timeoutMs = 30_000,
): Promise<'CAPTURE_COMPLETE' | 'CAPTURE_ERROR'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const actions = await getRecordedActions(popup);
    if (actions.includes('CAPTURE_COMPLETE')) return 'CAPTURE_COMPLETE';
    if (actions.includes('CAPTURE_ERROR')) return 'CAPTURE_ERROR';
    await popup.waitForTimeout(250);
  }
  throw new Error(`Capture did not complete within ${timeoutMs}ms`);
}

/**
 * Waits for the popup to show either "Done!" or "Capture failed" text.
 * Simpler alternative to waitForCaptureEnd — uses DOM visibility instead of
 * message recording, so it works without installMessageRecorder.
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
