const DEBUG = import.meta.env.DEV;

const UNINSTALL_SURVEY_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLScXHC9JS8BpATJninUmzZrOblWE6AMclkhjI-QVDQnKo82SSw/viewform';
chrome.runtime.setUninstallURL(UNINSTALL_SURVEY_URL);

const MAX_CANVAS_DIM = 16384;
const CAPTURE_INTERVAL_MS = 500;
const SCROLL_SETTLE_MS = 200;
const SEND_TIMEOUT_MS = 10_000;

interface PrepareResult {
  totalHeight: number;
  totalWidth: number;
  viewportHeight: number;
  viewportWidth: number;
  dpr: number;
  containerMode: boolean;
  containerRect?: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'START_CAPTURE') {
    captureFullPage(undefined, 0).catch(handleCaptureError('Capture failed'));
    sendResponse({ started: true });
    return true;
  }

  if (msg.action === 'START_PICKER') {
    startPicker().catch(handleCaptureError('Picker failed'));
    sendResponse({ started: true });
    return true;
  }

  if (msg.action === 'PICKER_RESULT') {
    const frameId = sender.frameId ?? 0;
    const isScrollable = msg.isScrollable as boolean;
    const isIframe = msg.isIframe as boolean;
    const iframeSrc = msg.iframeSrc as string | undefined;
    const targetRect = msg.targetRect as {
      top: number;
      left: number;
      width: number;
      height: number;
    };

    if (isIframe && iframeSrc) {
      handleIframeCapture(iframeSrc, targetRect).catch(handleCaptureError('Iframe capture failed'));
    } else if (isScrollable) {
      const targetIndex = msg.targetIndex as number;
      captureFullPage(targetIndex, frameId).catch(
        handleCaptureError('Capture after picker failed'),
      );
    } else {
      captureElement(targetRect).catch(handleCaptureError('Element capture failed'));
    }
    return false;
  }
});

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) throw new Error('No active tab found');

  if (/^(chrome|edge|about|devtools):/.test(tab.url || '')) {
    throw new Error('Cannot capture browser internal pages');
  }
  return tab.id;
}

async function injectContentScript(tabId: number): Promise<void> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js'],
    });
    if (DEBUG) console.log(`[FPS] Content script injected into ${results?.length ?? 0} frames`);
  } catch {
    // Some frames may block injection (chrome://, about:blank) — inject main frame only
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  }
  await sleep(100);
}

async function handleIframeCapture(
  iframeSrc: string,
  targetRect: { top: number; left: number; width: number; height: number },
): Promise<void> {
  const tabId = await getActiveTabId();
  const frames = await chrome.webNavigation.getAllFrames({ tabId });

  // Find the iframe's frameId by matching URL
  const iframeFrame = frames?.find((f) => f.frameId !== 0 && f.url === iframeSrc);

  if (!iframeFrame) {
    // Can't access iframe internals (cross-origin without match) — fall back to viewport crop
    if (DEBUG) console.log('[FPS] Iframe frame not found, falling back to viewport crop');
    await captureElement(targetRect);
    return;
  }

  const iframeFrameId = iframeFrame.frameId;
  if (DEBUG) console.log(`[FPS] Resolved iframe frameId=${iframeFrameId} for ${iframeSrc}`);

  // Try scroll+stitch inside the iframe
  try {
    await captureFullPage(undefined, iframeFrameId);
  } catch (err) {
    if (DEBUG)
      console.warn('[FPS] Iframe scroll+stitch failed, falling back to viewport crop:', err);
    await captureElement(targetRect);
  }
}

async function startPicker(): Promise<void> {
  const tabId = await getActiveTabId();
  await injectContentScript(tabId);
  await sendToTab(tabId, { action: 'ACTIVATE_PICKER' }, 0);
}

async function captureFullPage(targetIndex?: number, frameId = 0): Promise<void> {
  broadcast({ action: 'CAPTURE_PREPARING' });
  const tabId = await getActiveTabId();
  await injectContentScript(tabId);

  const prepareMsg: Record<string, unknown> = { action: 'PREPARE_CAPTURE' };
  if (targetIndex !== undefined) {
    prepareMsg.targetIndex = targetIndex;
  }
  const prep = (await sendToTab(tabId, prepareMsg, frameId)) as PrepareResult;

  const { totalHeight, totalWidth, viewportHeight, dpr, containerMode } = prep;
  const containerRect = prep.containerRect;

  // Determine canvas dimensions
  const captureWidth = containerMode && containerRect ? containerRect.width : totalWidth;
  const captureHeight = totalHeight;

  let canvasWidth = Math.round(captureWidth * dpr);
  let canvasHeight = Math.round(captureHeight * dpr);
  let scale = dpr;

  if (canvasWidth <= 0 || canvasHeight <= 0) {
    throw new Error('Page has no scrollable content to capture');
  }

  if (canvasWidth > MAX_CANVAS_DIM || canvasHeight > MAX_CANVAS_DIM) {
    const downscale = Math.min(MAX_CANVAS_DIM / canvasWidth, MAX_CANVAS_DIM / canvasHeight);
    scale = Math.max(dpr * downscale, 1);
    canvasWidth = Math.round(captureWidth * scale);
    canvasHeight = Math.round(captureHeight * scale);
  }

  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create 2d context');

  const totalSteps = Math.ceil(totalHeight / viewportHeight);
  let lastCaptureTime = 0;

  for (let i = 0; i < totalSteps; i++) {
    const scrollY = Math.min(i * viewportHeight, totalHeight - viewportHeight);

    const scrollResult = (await sendToTab(tabId, { action: 'SCROLL_TO', y: scrollY }, frameId)) as {
      actualY: number;
    };

    if (Math.abs(scrollResult.actualY - scrollY) > 2) {
      if (DEBUG)
        console.warn(`[FPS] Scroll mismatch: requested ${scrollY}, got ${scrollResult.actualY}`);
    }

    await sleep(SCROLL_SETTLE_MS);

    // Rate-limit captureVisibleTab
    const elapsed = Date.now() - lastCaptureTime;
    if (elapsed < CAPTURE_INTERVAL_MS) {
      await sleep(CAPTURE_INTERVAL_MS - elapsed);
    }

    const dataUrl = await chrome.tabs.captureVisibleTab({
      format: 'png',
    });
    lastCaptureTime = Date.now();

    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    const isLastStep = i === totalSteps - 1;
    const actualScrollY = Math.min(i * viewportHeight, totalHeight - viewportHeight);

    // Compute source region: container mode crops to container rect, document mode uses full bitmap
    const sx = containerMode && containerRect ? containerRect.left * dpr : 0;
    const sy = containerMode && containerRect ? containerRect.top * dpr : 0;
    const sw = containerMode && containerRect ? containerRect.width * dpr : bitmap.width;
    const sh = containerMode && containerRect ? containerRect.height * dpr : bitmap.height;

    if (isLastStep && totalSteps > 1) {
      const previousEnd = (totalSteps - 1) * viewportHeight;
      const srcYOffset = ((previousEnd - actualScrollY) / viewportHeight) * sh;
      const srcHeight = sh - srcYOffset;
      const drawY = previousEnd * scale;
      const drawHeight = srcHeight * (scale / dpr);
      const drawWidth = sw * (scale / dpr);
      ctx.drawImage(bitmap, sx, sy + srcYOffset, sw, srcHeight, 0, drawY, drawWidth, drawHeight);
    } else {
      const drawY = actualScrollY * scale;
      const drawHeight = sh * (scale / dpr);
      const drawWidth = sw * (scale / dpr);
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, drawY, drawWidth, drawHeight);
    }

    bitmap.close();
    broadcast({ action: 'PROGRESS', current: i + 1, total: totalSteps });

    // Hide fixed/sticky elements after first frame
    if (i === 0 && totalSteps > 1) {
      await sendToTab(tabId, { action: 'HIDE_FIXED' }, frameId);
    }
  }

  // Restore page state
  await sendToTab(tabId, { action: 'RESTORE' }, frameId);

  await downloadCanvas(canvas);
}

async function captureElement(rect: {
  top: number;
  left: number;
  width: number;
  height: number;
}): Promise<void> {
  const tabId = await getActiveTabId();

  const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  // Get DPR from content script
  const dprResult = (await sendToTab(tabId, { action: 'GET_DPR' }, 0)) as {
    dpr: number;
  } | null;
  const dpr = dprResult?.dpr || 2;

  const sx = Math.round(rect.left * dpr);
  const sy = Math.round(rect.top * dpr);
  const sw = Math.min(Math.round(rect.width * dpr), bitmap.width - sx);
  const sh = Math.min(Math.round(rect.height * dpr), bitmap.height - sy);

  if (sw <= 0 || sh <= 0) {
    bitmap.close();
    throw new Error('Selected element is outside the visible viewport');
  }

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create 2d context');

  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();

  await downloadCanvas(canvas);
}

// --- Helpers ---

function handleCaptureError(label: string) {
  return (err: Error) => {
    console.error(`[FPS] ${label}:`, err);
    broadcast({ action: 'CAPTURE_ERROR', error: err.message });
  };
}

async function downloadCanvas(canvas: OffscreenCanvas): Promise<void> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const filename = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  await chrome.downloads.download({ url, filename, saveAs: false });
  URL.revokeObjectURL(url);
  broadcast({ action: 'CAPTURE_COMPLETE' });
}

function sendToTab(
  tabId: number,
  message: Record<string, unknown>,
  frameId: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `sendToTab timeout after ${SEND_TIMEOUT_MS}ms (frame=${frameId}, action=${message.action})`,
        ),
      );
    }, SEND_TIMEOUT_MS);

    chrome.tabs.sendMessage(tabId, message, { frameId }, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function broadcast(message: Record<string, unknown>): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
