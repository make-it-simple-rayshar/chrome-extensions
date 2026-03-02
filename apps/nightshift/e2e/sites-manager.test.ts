import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Opens the popup page with a mocked chrome.tabs.query (so the popup sees a
 * non-restricted active tab), then navigates to the Sites Manager view.
 */
async function openSitesManager(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();

  await page.addInitScript(() => {
    const originalQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (
      queryInfo: chrome.tabs.QueryInfo,
      callback?: (tabs: chrome.tabs.Tab[]) => void,
    ) => {
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
        return Promise.resolve(fakeTabs) as unknown as ReturnType<typeof originalQuery>;
      }
      return originalQuery(queryInfo, callback);
    };
  });

  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('switch', { name: 'Global dark mode' }).waitFor({ timeout: 5000 });

  const manageBtn = page.getByRole('button', { name: 'Manage Sites' });
  await manageBtn.click();
  await expect(page.getByText('Manage Sites').first()).toBeVisible();

  return page;
}

test.describe('Sites Manager', () => {
  test('Sites tab renders with search input', async ({ context, extensionId }) => {
    const page = await openSitesManager(context, extensionId);

    await expect(page.getByRole('tab', { name: 'Sites' })).toBeVisible();
    await expect(page.getByLabel('Search domains')).toBeVisible();
  });

  test('Patterns tab allows adding a pattern', async ({ context, extensionId }) => {
    const page = await openSitesManager(context, extensionId);

    await page.getByRole('tab', { name: 'Patterns' }).click();
    const patternInput = page.getByRole('textbox', { name: 'Pattern' });
    await expect(patternInput).toBeVisible();

    await patternInput.fill('*.example.com');
    const addBtn = page.getByRole('button', { name: 'Add' });
    await expect(addBtn).toBeEnabled();
    await addBtn.click();

    await expect(page.getByText('*.example.com')).toBeVisible();
  });

  test('Bulk tab allows pasting domains', async ({ context, extensionId }) => {
    const page = await openSitesManager(context, extensionId);

    await page.getByRole('tab', { name: 'Bulk' }).click();
    const textarea = page.getByLabel('Bulk add domains');
    await expect(textarea).toBeVisible();

    await textarea.fill('example.com\ntest.org');
    const addAllBtn = page.getByRole('button', { name: 'Add All' });
    await expect(addAllBtn).toBeEnabled();
  });

  test('Export button is disabled when no sites exist', async ({ context, extensionId }) => {
    const page = await openSitesManager(context, extensionId);

    const exportBtn = page.getByRole('button', { name: 'Export' });
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toBeDisabled();
  });

  test('Import button is visible', async ({ context, extensionId }) => {
    const page = await openSitesManager(context, extensionId);

    const importBtn = page.getByRole('button', { name: 'Import' });
    await expect(importBtn).toBeVisible();
  });

  test('Back button returns to main view', async ({ context, extensionId }) => {
    const page = await openSitesManager(context, extensionId);

    const backBtn = page.getByRole('button', { name: 'Back to main view' });
    await backBtn.click();

    await expect(page.getByRole('switch', { name: 'Global dark mode' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Manage Sites' })).toBeVisible();
  });

  test('adding bulk domains then Remove All shows confirmation', async ({
    context,
    extensionId,
  }) => {
    const page = await openSitesManager(context, extensionId);

    // Add a bulk domain first so Remove All appears
    await page.getByRole('tab', { name: 'Bulk' }).click();
    const textarea = page.getByLabel('Bulk add domains');
    await textarea.fill('example.com');
    await page.getByRole('button', { name: 'Add All' }).click();

    // Switch to Sites tab to see the entry
    await page.getByRole('tab', { name: 'Sites' }).click();
    await expect(page.getByText('example.com')).toBeVisible();

    // Remove All button should now be visible
    const removeAllBtn = page.getByRole('button', { name: 'Remove All' });
    await expect(removeAllBtn).toBeVisible();
    await removeAllBtn.click();

    // Confirmation dialog should appear
    const dialog = page.getByRole('alertdialog', {
      name: 'Confirm removal of all sites and patterns',
    });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });
});
