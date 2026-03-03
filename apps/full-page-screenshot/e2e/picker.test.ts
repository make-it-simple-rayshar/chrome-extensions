import { expect, openPopup, test } from './fixtures';

async function getH1Box(page: import('@playwright/test').Page) {
  const box = await page.locator('h1').boundingBox();
  if (!box) throw new Error('h1 bounding box not found');
  return box;
}

function center(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('Element Picker', () => {
  test('clicking Select Element injects picker overlay on target page', async ({
    context,
    extensionId,
  }) => {
    const examplePage = await context.newPage();
    await examplePage.goto('https://example.com', { waitUntil: 'domcontentloaded' });

    const popup = await openPopup(context, extensionId);

    // Make example.com the active tab so background's getActiveTabId() returns it
    await examplePage.bringToFront();

    // Trigger picker from popup context
    await popup.evaluate(() => chrome.runtime.sendMessage({ action: 'START_PICKER' }));

    // Switch to example page and verify overlay elements
    await examplePage.waitForSelector('#__fps-glass', { timeout: 10_000 });
    await expect(examplePage.locator('#__fps-overlay')).toBeAttached();

    await popup.close();
  });

  test('hovering over element shows green highlight box', async ({ context, extensionId }) => {
    const examplePage = await context.newPage();
    await examplePage.goto('https://example.com', { waitUntil: 'domcontentloaded' });

    // Get h1 bounding box before picker activation (glass blocks element queries)
    const h1Box = await getH1Box(examplePage);

    const popup = await openPopup(context, extensionId);
    await examplePage.bringToFront();

    await popup.evaluate(() => chrome.runtime.sendMessage({ action: 'START_PICKER' }));
    await examplePage.waitForSelector('#__fps-glass', { timeout: 10_000 });

    // Wait past ARM_DELAY_MS (400ms)
    await examplePage.waitForTimeout(500);

    // Move mouse over h1 location
    const { x, y } = center(h1Box);
    await examplePage.mouse.move(x, y);

    // Assert highlight becomes visible with green border
    const highlight = examplePage.locator('#__fps-highlight');
    await expect(highlight).toBeVisible({ timeout: 5000 });

    const borderColor = await highlight.evaluate((el) => getComputedStyle(el).borderColor);
    expect(borderColor).toBe('rgb(34, 197, 94)');

    await popup.close();
  });

  test('tooltip shows element info', async ({ context, extensionId }) => {
    const examplePage = await context.newPage();
    await examplePage.goto('https://example.com', { waitUntil: 'domcontentloaded' });

    const h1Box = await getH1Box(examplePage);

    const popup = await openPopup(context, extensionId);
    await examplePage.bringToFront();

    await popup.evaluate(() => chrome.runtime.sendMessage({ action: 'START_PICKER' }));
    await examplePage.waitForSelector('#__fps-glass', { timeout: 10_000 });

    await examplePage.waitForTimeout(500);

    const { x, y } = center(h1Box);
    await examplePage.mouse.move(x, y);

    const tooltip = examplePage.locator('#__fps-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 5000 });

    const tooltipText = await tooltip.textContent();
    expect(tooltipText?.toLowerCase()).toContain('h1');

    await popup.close();
  });

  test('clicking element removes overlay', async ({ context, extensionId }) => {
    const examplePage = await context.newPage();
    await examplePage.goto('https://example.com', { waitUntil: 'domcontentloaded' });

    const h1Box = await getH1Box(examplePage);

    const popup = await openPopup(context, extensionId);
    await examplePage.bringToFront();

    await popup.evaluate(() => chrome.runtime.sendMessage({ action: 'START_PICKER' }));
    await examplePage.waitForSelector('#__fps-glass', { timeout: 10_000 });

    await examplePage.waitForTimeout(500);

    // Hover then click at h1 location
    const { x, y } = center(h1Box);
    await examplePage.mouse.move(x, y);
    await examplePage.waitForTimeout(200);
    await examplePage.mouse.click(x, y);

    // Wait for glass overlay to be removed from DOM
    await examplePage.waitForSelector('#__fps-glass', { state: 'detached', timeout: 10_000 });
    await expect(examplePage.locator('#__fps-overlay')).not.toBeAttached();

    await popup.close();
  });

  test('picker can be re-activated after selection', async ({ context, extensionId }) => {
    const examplePage = await context.newPage();
    await examplePage.goto('https://example.com', { waitUntil: 'domcontentloaded' });

    const h1Box = await getH1Box(examplePage);

    const popup = await openPopup(context, extensionId);
    await examplePage.bringToFront();

    // First activation
    await popup.evaluate(() => chrome.runtime.sendMessage({ action: 'START_PICKER' }));
    await examplePage.waitForSelector('#__fps-glass', { timeout: 10_000 });

    await examplePage.waitForTimeout(500);

    // Select an element to complete the first picker session
    const { x, y } = center(h1Box);
    await examplePage.mouse.move(x, y);
    await examplePage.waitForTimeout(200);
    await examplePage.mouse.click(x, y);

    // Wait for overlay cleanup
    await examplePage.waitForSelector('#__fps-glass', { state: 'detached', timeout: 10_000 });

    // Wait for potential capture to process
    await examplePage.waitForTimeout(1000);

    // Re-activate picker
    await examplePage.bringToFront();
    await popup.evaluate(() => chrome.runtime.sendMessage({ action: 'START_PICKER' }));

    // Verify glass overlay appears again
    await examplePage.waitForSelector('#__fps-glass', { timeout: 10_000 });
    await expect(examplePage.locator('#__fps-overlay')).toBeAttached();

    await popup.close();
  });
});
