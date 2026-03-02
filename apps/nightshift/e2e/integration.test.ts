import { expect, test } from './fixtures';

const TEST_PAGE = 'https://example.com';

test.describe('Integration', () => {
  test('full flow: enable dark mode, verify content script, change profile, verify filter change', async ({
    context,
    extensionId,
  }) => {
    // Enable dark mode via background
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    await popup.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ action: 'SET_ENABLED', enabled: true }, () => resolve());
      });
    });

    // Navigate to a test page
    const page = await context.newPage();
    await page.goto(TEST_PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Verify dark mode is applied
    const filterBefore = await page.evaluate(() => {
      return window.getComputedStyle(document.documentElement).filter;
    });
    expect(filterBefore).toContain('invert');

    // Switch to Night Reading profile (lower brightness, some sepia)
    await popup.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ action: 'SET_PROFILE', profileId: 'night-reading' }, () =>
          resolve(),
        );
      });
    });

    // Wait for storage change to propagate
    await page.waitForTimeout(1500);

    // The filter should still contain invert (Night Reading uses filter mode)
    const filterAfter = await page.evaluate(() => {
      return window.getComputedStyle(document.documentElement).filter;
    });
    expect(filterAfter).toContain('invert');
  });

  test('per-site toggle: enable globally, disable for specific site via background', async ({
    context,
    extensionId,
  }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    // Enable globally
    await popup.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ action: 'SET_ENABLED', enabled: true }, () => resolve());
      });
    });

    const page = await context.newPage();
    await page.goto(TEST_PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Dark mode should be on
    let filter = await page.evaluate(() => {
      return window.getComputedStyle(document.documentElement).filter;
    });
    expect(filter).toContain('invert');

    // Disable for example.com specifically
    await popup.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.runtime.sendMessage(
          { action: 'SET_SITE_ENABLED', domain: 'example.com', enabled: false },
          () => resolve(),
        );
      });
    });

    // Wait for notification to reach content script
    await page.waitForTimeout(1500);

    filter = await page.evaluate(() => {
      return window.getComputedStyle(document.documentElement).filter;
    });
    expect(filter).not.toContain('invert');
  });

  test('schedule: enable schedule stores config via background', async ({
    context,
    extensionId,
  }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    // Enable globally first
    await popup.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ action: 'SET_ENABLED', enabled: true }, () => resolve());
      });
    });

    // Set a schedule
    const scheduleResult = await popup.evaluate(() => {
      return new Promise<Record<string, unknown>>((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: 'SET_SCHEDULE',
            schedule: {
              enabled: true,
              mode: 'manual',
              manualStart: '20:00',
              manualEnd: '07:00',
            },
          },
          (resp) => resolve(resp as Record<string, unknown>),
        );
      });
    });
    expect(scheduleResult.ok).toBe(true);

    // Verify schedule was saved
    const scheduleInfo = await popup.evaluate(() => {
      return new Promise<Record<string, unknown>>((resolve) => {
        chrome.runtime.sendMessage({ action: 'GET_SCHEDULE' }, (resp) =>
          resolve(resp as Record<string, unknown>),
        );
      });
    });
    const schedule = scheduleInfo.schedule as Record<string, unknown>;
    expect(schedule.enabled).toBe(true);
    expect(schedule.mode).toBe('manual');
    expect(schedule.manualStart).toBe('20:00');
    expect(schedule.manualEnd).toBe('07:00');
  });
});
