import {
  expect,
  getRecordedActions,
  installMessageRecorder,
  test,
  triggerCapture,
  waitForCaptureEnd,
} from './fixtures';

const TEST_PAGE = 'https://example.com';

test.describe('Full Capture Flow', () => {
  test('full capture on example.com completes successfully', async ({ context, extensionId }) => {
    const { popup } = await triggerCapture(context, extensionId, TEST_PAGE);

    const result = await waitForCaptureEnd(popup);
    expect(result).toBe('CAPTURE_COMPLETE');
  });

  test('progress messages are sent during capture', async ({ context, extensionId }) => {
    const { popup } = await triggerCapture(context, extensionId, TEST_PAGE);

    await waitForCaptureEnd(popup);

    const actions = await getRecordedActions(popup);
    expect(actions).toContain('CAPTURE_PREPARING');
    expect(actions).toContain('PROGRESS');
    expect(actions).toContain('CAPTURE_COMPLETE');
  });

  test('after capture completes, popup resets to idle', async ({ context, extensionId }) => {
    const { popup } = await triggerCapture(context, extensionId, TEST_PAGE);

    await waitForCaptureEnd(popup);

    // The popup auto-resets after 2 seconds — wait a bit longer to be safe
    await popup.waitForTimeout(2500);

    // Bring popup to front for UI assertions
    await popup.bringToFront();

    // Buttons should be back to idle state
    const captureButton = popup.getByRole('button', { name: 'Capture Full Page' });
    await expect(captureButton).toBeVisible();
    await expect(captureButton).toBeEnabled();

    const pickerButton = popup.getByRole('button', { name: 'Select Element' });
    await expect(pickerButton).toBeEnabled();
  });

  test('download file is created after capture', async ({ context, extensionId }) => {
    const { popup } = await triggerCapture(context, extensionId, TEST_PAGE);

    await waitForCaptureEnd(popup);

    // Allow time for the download to register in chrome.downloads
    await popup.waitForTimeout(1000);

    // Query Chrome downloads API from the popup context
    const downloads = await popup.evaluate(() => {
      return new Promise<{ filename: string; state: string }[]>((resolve) => {
        chrome.downloads.search({ orderBy: ['-startTime'], limit: 5 }, (results) =>
          resolve(results.map((r) => ({ filename: r.filename, state: r.state }))),
        );
      });
    });

    expect(downloads.length).toBeGreaterThan(0);
    expect(downloads[0].state).toBe('complete');
  });

  test('second capture works after first', async ({ context, extensionId }) => {
    const { targetPage, popup } = await triggerCapture(context, extensionId, TEST_PAGE);

    const firstResult = await waitForCaptureEnd(popup);
    expect(firstResult).toBe('CAPTURE_COMPLETE');

    // Wait for auto-reset back to idle
    await popup.waitForTimeout(2500);

    // Install fresh message recorder for the second capture
    await installMessageRecorder(popup);

    // Bring target page to front for second capture
    await targetPage.bringToFront();
    await popup.evaluate(() => chrome.runtime.sendMessage({ action: 'START_CAPTURE' }));

    const secondResult = await waitForCaptureEnd(popup);
    expect(secondResult).toBe('CAPTURE_COMPLETE');
  });
});
