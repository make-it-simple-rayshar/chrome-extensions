import { expect, test } from './fixtures';

/**
 * Content script tests.
 *
 * These tests navigate to a real website and verify that the content script
 * injects or removes the dark mode CSS filter on the page.
 *
 * We use a data: URI or a simple HTTP page to avoid external dependencies.
 * Note: content scripts with <all_urls> match http/https but NOT data: URIs,
 * so we use a local page served by Playwright or a well-known site.
 */

const TEST_PAGE = 'https://example.com';

test.describe('Content Script', () => {
  test('content script injects dark mode filter when enabled', async ({ context, extensionId }) => {
    // First enable dark mode via the popup on a real page
    const page = await context.newPage();
    await page.goto(TEST_PAGE, { waitUntil: 'domcontentloaded' });

    // Open popup to enable dark mode
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    // The popup sees a restricted page (chrome-extension://) so global toggle
    // is in the restricted view. We need to enable via the background script directly.
    // Use chrome.runtime.sendMessage via evaluate in the popup context.
    await popup.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ action: 'SET_ENABLED', enabled: true }, () => resolve());
      });
    });

    // Wait for the content script to apply the filter
    await page.waitForTimeout(500);

    // Reload the page to let the content script apply dark mode on fresh load
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Check if the HTML element has an invert filter applied
    const filter = await page.evaluate(() => {
      const html = document.documentElement;
      return window.getComputedStyle(html).filter;
    });

    expect(filter).toContain('invert');
  });

  test('content script does NOT inject when dark mode is OFF', async ({ context, extensionId }) => {
    // Ensure dark mode is off
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    await popup.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ action: 'SET_ENABLED', enabled: false }, () => resolve());
      });
    });

    const page = await context.newPage();
    await page.goto(TEST_PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const filter = await page.evaluate(() => {
      const html = document.documentElement;
      return window.getComputedStyle(html).filter;
    });

    // Should be "none" or not contain "invert"
    expect(filter).not.toContain('invert');
  });

  test('toggling in popup reflects on the page', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(TEST_PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Enable dark mode via background
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    await popup.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ action: 'SET_ENABLED', enabled: true }, () => resolve());
      });
    });

    // Wait for storage change to propagate to content script
    await page.waitForTimeout(1500);

    const filterOn = await page.evaluate(() => {
      return window.getComputedStyle(document.documentElement).filter;
    });
    expect(filterOn).toContain('invert');

    // Now disable
    await popup.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ action: 'SET_ENABLED', enabled: false }, () => resolve());
      });
    });

    await page.waitForTimeout(1500);

    const filterOff = await page.evaluate(() => {
      return window.getComputedStyle(document.documentElement).filter;
    });
    expect(filterOff).not.toContain('invert');
  });

  test('CSS filter is applied to HTML element with hue-rotate', async ({
    context,
    extensionId,
  }) => {
    // Enable dark mode
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    await popup.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ action: 'SET_ENABLED', enabled: true }, () => resolve());
      });
    });

    const page = await context.newPage();
    await page.goto(TEST_PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const filter = await page.evaluate(() => {
      return window.getComputedStyle(document.documentElement).filter;
    });

    // The filter should contain both invert and hue-rotate
    expect(filter).toContain('invert');
    expect(filter).toContain('hue-rotate');
  });
});
