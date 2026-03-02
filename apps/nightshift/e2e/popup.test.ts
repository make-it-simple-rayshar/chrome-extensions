import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Opens the popup page and injects a mock for chrome.tabs.query so the popup
 * thinks the active tab is a regular web page (not a chrome-extension:// URL).
 * This is necessary because opening popup.html as a page makes it the active tab,
 * which triggers the "restricted page" view.
 */
async function openPopupWithMockedTab(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();

  // Mock chrome.tabs.query before the popup script runs
  await page.addInitScript(() => {
    const originalQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (
      queryInfo: chrome.tabs.QueryInfo,
      callback?: (tabs: chrome.tabs.Tab[]) => void,
    ) => {
      // If querying for active tab in current window, return a fake tab
      if (queryInfo.active && queryInfo.currentWindow) {
        const fakeTabs: chrome.tabs.Tab[] = [
          {
            id: 9999,
            index: 0,
            windowId: 1,
            highlighted: true,
            active: true,
            pinned: false,
            incognito: false,
            url: 'https://example.com/',
            title: 'Example Domain',
            groupId: -1,
            discarded: false,
            autoDiscardable: true,
            selected: true,
          },
        ];
        if (callback) {
          callback(fakeTabs);
        }
        // Return a promise-like for MV3 compatibility
        return Promise.resolve(fakeTabs) as unknown as ReturnType<typeof originalQuery>;
      }
      return originalQuery(queryInfo, callback);
    };
  });

  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForLoadState('domcontentloaded');

  // Wait for the popup to finish loading (the loading state)
  // The popup sets loading=false after init, so wait for the toggle to appear
  await page.getByRole('switch', { name: 'Global dark mode' }).waitFor({ timeout: 5000 });

  return page;
}

test.describe('Popup -- restricted page', () => {
  test('shows unavailable message on chrome-extension:// pages', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('NightShift')).toBeVisible();
    await expect(page.getByText('Dark mode unavailable on this page')).toBeVisible();
  });
});

test.describe('Popup -- main view', () => {
  test('renders with NightShift title', async ({ context, extensionId }) => {
    const page = await openPopupWithMockedTab(context, extensionId);
    await expect(page.getByText('NightShift')).toBeVisible();
  });

  test('global toggle switch is visible and clickable', async ({ context, extensionId }) => {
    const page = await openPopupWithMockedTab(context, extensionId);
    const toggle = page.getByRole('switch', { name: 'Global dark mode' });
    await expect(toggle).toBeVisible();
  });

  test('toggle ON -- state persists in storage', async ({ context, extensionId }) => {
    const page = await openPopupWithMockedTab(context, extensionId);
    const toggle = page.getByRole('switch', { name: 'Global dark mode' });
    await toggle.click();
    await expect(toggle).toBeChecked();

    // Verify via background that state was saved
    const state = await page.evaluate(() => {
      return new Promise<Record<string, unknown>>((resolve) => {
        chrome.runtime.sendMessage({ action: 'GET_STATE', domain: 'example.com' }, (resp) =>
          resolve(resp as Record<string, unknown>),
        );
      });
    });
    expect(state.globalEnabled).toBe(true);
  });

  test('toggle OFF -- state persists', async ({ context, extensionId }) => {
    const page = await openPopupWithMockedTab(context, extensionId);
    const toggle = page.getByRole('switch', { name: 'Global dark mode' });

    // Toggle ON then OFF
    await toggle.click();
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    const state = await page.evaluate(() => {
      return new Promise<Record<string, unknown>>((resolve) => {
        chrome.runtime.sendMessage({ action: 'GET_STATE', domain: 'example.com' }, (resp) =>
          resolve(resp as Record<string, unknown>),
        );
      });
    });
    expect(state.globalEnabled).toBe(false);
  });

  test('shows built-in profiles (Standard, Night Reading, OLED) when ON', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopupWithMockedTab(context, extensionId);
    const toggle = page.getByRole('switch', { name: 'Global dark mode' });
    await toggle.click();
    await expect(toggle).toBeChecked();

    await expect(page.getByRole('button', { name: 'Standard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Night Reading' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'OLED' })).toBeVisible();
  });

  test('switching profile changes active profile', async ({ context, extensionId }) => {
    const page = await openPopupWithMockedTab(context, extensionId);
    const toggle = page.getByRole('switch', { name: 'Global dark mode' });
    await toggle.click();

    const nightReading = page.getByRole('button', { name: 'Night Reading' });
    await nightReading.click();

    // Wait for profile switch to register
    await page.waitForTimeout(500);
    await expect(nightReading).toHaveAttribute('aria-pressed', 'true');

    const standard = page.getByRole('button', { name: 'Standard' });
    await expect(standard).toHaveAttribute('aria-pressed', 'false');
  });

  test('built-in profiles do not show delete button', async ({ context, extensionId }) => {
    const page = await openPopupWithMockedTab(context, extensionId);
    const toggle = page.getByRole('switch', { name: 'Global dark mode' });
    await toggle.click();

    const standard = page.getByRole('button', { name: 'Standard' });
    await standard.click();
    await expect(page.getByRole('button', { name: 'Delete Standard' })).toBeHidden();
  });

  test('filter sliders appear when dark mode is ON and filter mode', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopupWithMockedTab(context, extensionId);
    const toggle = page.getByRole('switch', { name: 'Global dark mode' });
    await toggle.click();

    // Per-site toggle should also be on (auto mode with global ON = effective ON)
    // Sliders should appear since default profile is "filter" mode
    await expect(page.getByText('Brightness')).toBeVisible();
    await expect(page.getByText('Contrast')).toBeVisible();
    await expect(page.getByText('Sepia')).toBeVisible();
  });

  test('schedule section toggle works', async ({ context, extensionId }) => {
    const page = await openPopupWithMockedTab(context, extensionId);
    const globalToggle = page.getByRole('switch', { name: 'Global dark mode' });
    await globalToggle.click();

    const scheduleToggle = page.getByRole('switch', { name: 'Auto schedule' });
    await expect(scheduleToggle).toBeVisible();

    await scheduleToggle.click();
    await expect(scheduleToggle).toBeChecked();

    await expect(page.getByRole('tab', { name: 'Sunset/sunrise' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Custom times' })).toBeVisible();
  });

  test('schedule mode tabs switch correctly', async ({ context, extensionId }) => {
    const page = await openPopupWithMockedTab(context, extensionId);
    const globalToggle = page.getByRole('switch', { name: 'Global dark mode' });
    await globalToggle.click();

    const scheduleToggle = page.getByRole('switch', { name: 'Auto schedule' });
    await scheduleToggle.click();

    const sunsetTab = page.getByRole('tab', { name: 'Sunset/sunrise' });
    await sunsetTab.click();
    await expect(page.getByLabel('City')).toBeVisible();

    const customTab = page.getByRole('tab', { name: 'Custom times' });
    await customTab.click();
    await expect(page.getByLabel('Start')).toBeVisible();
    await expect(page.getByLabel('End')).toBeVisible();
  });

  test('Manage Sites button navigates to sites view', async ({ context, extensionId }) => {
    const page = await openPopupWithMockedTab(context, extensionId);

    const manageBtn = page.getByRole('button', { name: 'Manage Sites' });
    await expect(manageBtn).toBeVisible();
    await manageBtn.click();

    await expect(page.getByText('Manage Sites').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to main view' })).toBeVisible();
  });

  test('"+ Save as..." button opens create profile form', async ({ context, extensionId }) => {
    const page = await openPopupWithMockedTab(context, extensionId);
    const toggle = page.getByRole('switch', { name: 'Global dark mode' });
    await toggle.click();

    await page.getByRole('button', { name: '+ Save as...' }).click();
    await expect(page.getByLabel('New profile name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  });
});
