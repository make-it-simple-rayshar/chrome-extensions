import type { Page } from '@playwright/test';
import { expect, openPopup, test } from './fixtures';

/**
 * Simulate an incoming chrome.runtime.onMessage event in the popup.
 *
 * `chrome.runtime.sendMessage()` from the popup goes to the background, not
 * back to the popup's own onMessage listener.  To trigger the popup's listener
 * we need to dispatch the event directly via the internal Chrome event API.
 */
async function simulateMessage(page: Page, msg: Record<string, unknown>) {
  await page.evaluate((m) => {
    // Chrome extension Event objects expose `dispatch` or we can call
    // registered listeners via the public `_listeners` array. The simplest
    // reliable approach: use the undocumented but stable `dispatch` method
    // available on chrome.runtime.onMessage in MV3 popup contexts.  If that
    // doesn't exist, fall back to iterating registered listeners.
    const event = chrome.runtime.onMessage as unknown as {
      _listeners?: Array<(msg: unknown) => void>;
      dispatch: (msg: unknown, sender: unknown, sendResponse: () => void) => void;
    };

    if (typeof event.dispatch === 'function') {
      event.dispatch(m, {}, () => {});
    } else if (Array.isArray(event._listeners)) {
      for (const fn of event._listeners) {
        fn(m);
      }
    }
  }, msg);
}

test.describe('Popup -- idle state', () => {
  test('both buttons visible and enabled in idle state', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    const captureBtn = page.getByRole('button', { name: 'Capture Full Page' });
    const selectBtn = page.getByRole('button', { name: 'Select Element' });

    await expect(captureBtn).toBeVisible();
    await expect(captureBtn).toBeEnabled();
    await expect(selectBtn).toBeVisible();
    await expect(selectBtn).toBeEnabled();
  });

  test('correct button labels in idle', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    await expect(page.getByRole('button', { name: 'Capture Full Page' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select Element' })).toBeVisible();
    await expect(page.getByText('Capturing...')).toBeHidden();
    await expect(page.getByText('Selecting...')).toBeHidden();
  });

  test('feedback link present', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    const link = page.getByRole('link', { name: /Send feedback/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /docs\.google\.com\/forms/);
  });
});

test.describe('Popup -- state transitions via messages', () => {
  test('CAPTURE_PREPARING disables buttons and shows Capturing...', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);

    await simulateMessage(page, { action: 'CAPTURE_PREPARING' });

    const captureBtn = page.getByRole('button', { name: 'Capturing...' });
    await expect(captureBtn).toBeVisible();
    await expect(captureBtn).toBeDisabled();

    const selectBtn = page.getByRole('button', { name: 'Select Element' });
    await expect(selectBtn).toBeDisabled();
  });

  test('PROGRESS shows progress bar and capture count', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    await simulateMessage(page, { action: 'PROGRESS', current: 2, total: 5 });

    await expect(page.getByText('Capturing... 2/5')).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeVisible();
  });

  test('CAPTURE_COMPLETE shows done message', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    await simulateMessage(page, { action: 'CAPTURE_COMPLETE' });

    await expect(page.getByText('Done! Screenshot saved.')).toBeVisible();
  });

  test('done state auto-resets after 2s', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    await simulateMessage(page, { action: 'CAPTURE_COMPLETE' });

    await expect(page.getByText('Done! Screenshot saved.')).toBeVisible();

    // Wait for auto-reset (~2s timeout in App.tsx)
    await page.waitForTimeout(2500);

    await expect(page.getByText('Done! Screenshot saved.')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Capture Full Page' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Select Element' })).toBeEnabled();
  });

  test('CAPTURE_ERROR shows error text and auto-resets', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    await simulateMessage(page, { action: 'CAPTURE_ERROR' });

    await expect(
      page.getByText('Capture failed. Try using "Select Element" instead.'),
    ).toBeVisible();

    // Wait for auto-reset (~4s timeout in App.tsx)
    await page.waitForTimeout(4500);

    await expect(
      page.getByText('Capture failed. Try using "Select Element" instead.'),
    ).toBeHidden();
    await expect(page.getByRole('button', { name: 'Capture Full Page' })).toBeEnabled();
  });
});
