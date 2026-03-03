import { expect, openPopup, test, triggerCaptureAndWait } from './fixtures';

test.describe('Content Script Integration', () => {
  test('scrollbar-hide style injected during capture and removed after', async ({
    context,
    extensionId,
  }) => {
    const targetPage = await context.newPage();
    await targetPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });

    // Set up MutationObserver to detect scrollbar-hide style injection
    await targetPage.evaluate(() => {
      (window as Record<string, unknown>).__scrollbarHideDetected = false;
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if ((node as Element).id === '__fps-scrollbar-hide') {
              (window as Record<string, unknown>).__scrollbarHideDetected = true;
            }
          }
        }
      });
      observer.observe(document.head, { childList: true });
    });

    const popup = await openPopup(context, extensionId);
    await triggerCaptureAndWait(popup, targetPage);

    // Style WAS injected during capture
    const detected = await targetPage.evaluate(
      () => (window as Record<string, unknown>).__scrollbarHideDetected,
    );
    expect(detected).toBe(true);

    // Style was removed after RESTORE
    const styleExists = await targetPage.evaluate(
      () => document.getElementById('__fps-scrollbar-hide') !== null,
    );
    expect(styleExists).toBe(false);
  });

  test('page scroll position restored after capture', async ({ context, extensionId }) => {
    const targetPage = await context.newPage();
    await targetPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });

    // Make page tall enough to scroll
    await targetPage.evaluate(() => {
      document.body.style.height = '3000px';
    });

    // Scroll to Y=200
    await targetPage.evaluate(() => window.scrollTo(0, 200));
    expect(await targetPage.evaluate(() => window.scrollY)).toBe(200);

    const popup = await openPopup(context, extensionId);
    await triggerCaptureAndWait(popup, targetPage);

    // Scroll position should be restored
    await targetPage.bringToFront();
    const scrollY = await targetPage.evaluate(() => window.scrollY);
    expect(scrollY).toBe(200);
  });

  test('fixed/sticky elements hidden during multi-frame capture and restored', async ({
    context,
    extensionId,
  }) => {
    const targetPage = await context.newPage();
    await targetPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });

    // Make page tall for multi-frame capture
    await targetPage.evaluate(() => {
      document.body.style.height = '5000px';
    });

    // Inject a fixed header element
    await targetPage.evaluate(() => {
      const header = document.createElement('div');
      header.id = 'test-fixed-header';
      header.style.position = 'fixed';
      header.style.top = '0';
      header.style.width = '100%';
      header.style.height = '50px';
      header.style.background = 'red';
      header.style.zIndex = '1000';
      document.body.appendChild(header);
    });

    // Set up observer to detect when fixed header visibility changes
    await targetPage.evaluate(() => {
      (window as Record<string, unknown>).__headerWasHidden = false;
      const observer = new MutationObserver(() => {
        const header = document.getElementById('test-fixed-header');
        if (header && header.style.visibility === 'hidden') {
          (window as Record<string, unknown>).__headerWasHidden = true;
        }
      });
      const header = document.getElementById('test-fixed-header');
      if (header) {
        observer.observe(header, { attributes: true, attributeFilter: ['style'] });
      }
    });

    const popup = await openPopup(context, extensionId);
    await triggerCaptureAndWait(popup, targetPage);

    // HIDE_FIXED was called (header was hidden during capture)
    const wasHidden = await targetPage.evaluate(
      () => (window as Record<string, unknown>).__headerWasHidden,
    );
    expect(wasHidden).toBe(true);

    // Header visibility is restored after RESTORE
    const visibility = await targetPage.evaluate(() => {
      const h = document.getElementById('test-fixed-header');
      return h ? h.style.visibility : 'not found';
    });
    expect(visibility).not.toBe('hidden');
  });

  test('second capture works after first (injection guard properly managed)', async ({
    context,
    extensionId,
  }) => {
    const targetPage = await context.newPage();
    await targetPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });

    // Set up observer to count scrollbar-hide style injections across both captures.
    // Each capture injects the style during PREPARE and removes it during RESTORE.
    await targetPage.evaluate(() => {
      (window as Record<string, unknown>).__scrollbarHideCount = 0;
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if ((node as Element).id === '__fps-scrollbar-hide') {
              (window as Record<string, unknown>).__scrollbarHideCount =
                ((window as Record<string, unknown>).__scrollbarHideCount as number) + 1;
            }
          }
        }
      });
      observer.observe(document.head, { childList: true });
    });

    // First capture
    const popup = await openPopup(context, extensionId);
    await triggerCaptureAndWait(popup, targetPage);

    // Wait for the "Capture Full Page" button to become enabled after auto-reset
    await expect(popup.getByRole('button', { name: 'Capture Full Page' })).toBeEnabled({
      timeout: 5000,
    });

    // Second capture
    await triggerCaptureAndWait(popup, targetPage);

    // Both captures injected the scrollbar-hide style, proving re-injection worked.
    // Count may exceed 2 when allFrames injection adds the style in sub-frames.
    const count = await targetPage.evaluate(
      () => (window as Record<string, unknown>).__scrollbarHideCount as number,
    );
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
