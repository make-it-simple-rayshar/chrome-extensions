const MAX_CANVAS_DIM = 16384;
const CAPTURE_INTERVAL_MS = 500;
const SCROLL_SETTLE_MS = 200;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'START_CAPTURE') {
    captureFullPage().catch((err) => {
      console.error('[FullPageScreenshot] Capture failed:', err);
      broadcast({ action: 'CAPTURE_ERROR', error: err.message });
    });
    sendResponse({ started: true });
    return true;
  }
});

async function captureFullPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found');

  if (/^(chrome|edge|about|devtools):/.test(tab.url || '')) {
    throw new Error('Cannot capture browser internal pages');
  }

  // Inject content script
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js'],
  });

  // Small delay to ensure content script listener is registered
  await sleep(100);

  // Measure page dimensions
  const prepareResult = await sendToTab(tab.id, { action: 'PREPARE_CAPTURE' });
  const { totalHeight, totalWidth, viewportHeight, viewportWidth, dpr } = prepareResult;

  // Calculate canvas dimensions with safety limit
  let canvasWidth = totalWidth * dpr;
  let canvasHeight = totalHeight * dpr;
  let scale = dpr;

  if (canvasWidth > MAX_CANVAS_DIM || canvasHeight > MAX_CANVAS_DIM) {
    const downscale = Math.min(MAX_CANVAS_DIM / canvasWidth, MAX_CANVAS_DIM / canvasHeight);
    scale = Math.max(dpr * downscale, 1);
    canvasWidth = Math.round(totalWidth * scale);
    canvasHeight = Math.round(totalHeight * scale);
  }

  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');

  const totalSteps = Math.ceil(totalHeight / viewportHeight);
  let lastCaptureTime = 0;

  for (let i = 0; i < totalSteps; i++) {
    const scrollY = Math.min(i * viewportHeight, totalHeight - viewportHeight);

    await sendToTab(tab.id, { action: 'SCROLL_TO', y: scrollY });

    // Wait for lazy-loaded content, animations, etc.
    await sleep(SCROLL_SETTLE_MS);

    // Rate-limit captureVisibleTab (~2 calls/sec max in Chrome)
    const elapsed = Date.now() - lastCaptureTime;
    if (elapsed < CAPTURE_INTERVAL_MS) {
      await sleep(CAPTURE_INTERVAL_MS - elapsed);
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    lastCaptureTime = Date.now();

    // Decode captured image and draw onto stitching canvas
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    // For the last step, we may have scrolled less than a full viewport.
    // Calculate the exact source region to avoid overlap artifacts.
    const isLastStep = i === totalSteps - 1;
    const expectedScrollY = i * viewportHeight;
    const actualScrollY = Math.min(expectedScrollY, totalHeight - viewportHeight);

    if (isLastStep && totalSteps > 1) {
      // Last frame: only draw the portion that wasn't captured by previous frames
      const overlap = actualScrollY + viewportHeight - totalHeight;
      const skipPx = (viewportHeight - (totalHeight - actualScrollY)) * dpr;
      // Actually: the captured image starts at actualScrollY, we need to draw the
      // part from (previousEnd - actualScrollY) to end
      const previousEnd = (totalSteps - 1) * viewportHeight;
      const srcYOffset = (previousEnd - actualScrollY) * (bitmap.height / viewportHeight);

      const srcHeight = bitmap.height - srcYOffset;
      const drawY = previousEnd * scale;
      const drawHeight = srcHeight * (scale / dpr);
      const drawWidth = bitmap.width * (scale / dpr);

      ctx.drawImage(
        bitmap,
        0,
        srcYOffset,
        bitmap.width,
        srcHeight,
        0,
        drawY,
        drawWidth,
        drawHeight,
      );
    } else {
      const drawY = actualScrollY * scale;
      const drawHeight = bitmap.height * (scale / dpr);
      const drawWidth = bitmap.width * (scale / dpr);
      ctx.drawImage(bitmap, 0, drawY, drawWidth, drawHeight);
    }

    bitmap.close();

    broadcast({ action: 'PROGRESS', current: i + 1, total: totalSteps });

    // Hide fixed/sticky elements after first frame
    if (i === 0 && totalSteps > 1) {
      await sendToTab(tab.id, { action: 'HIDE_FIXED' });
    }
  }

  // Restore page state
  await sendToTab(tab.id, { action: 'RESTORE' });

  // Convert canvas to blob and download via chrome.downloads API
  const resultBlob = await canvas.convertToBlob({ type: 'image/png' });
  const resultDataUrl = await blobToDataUrl(resultBlob);

  const filename = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  await chrome.downloads.download({
    url: resultDataUrl,
    filename,
    saveAs: false,
  });

  broadcast({ action: 'CAPTURE_COMPLETE' });
}

// --- Helpers ---

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Chunked conversion — avoids O(n²) string concatenation
  const CHUNK = 0x8000;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
  }
  return `data:image/png;base64,${btoa(chunks.join(''))}`;
}
