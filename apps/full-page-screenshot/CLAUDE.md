# Full Page Screenshot

Captures full-page screenshots using scroll-and-stitch technique with OffscreenCanvas.

## Architecture

```
popup.html/js  →  background.js (service worker)  →  content.js (injected)
   UI button        captureFullPage()                   scroll, measure, hide fixed
                    OffscreenCanvas stitching
                    chrome.downloads.download()
```

## Flow

1. User clicks "Capture Full Page" in popup
2. Popup sends `START_CAPTURE` to background service worker
3. Background injects content.js, sends `PREPARE_CAPTURE` to measure page dimensions
4. Loop: `SCROLL_TO` → wait → `captureVisibleTab()` → draw on OffscreenCanvas
5. After first frame, `HIDE_FIXED` hides sticky/fixed elements (navbars, banners)
6. `RESTORE` returns page to original state
7. Canvas → PNG blob → `chrome.downloads.download()`

## Files

- `background.js` — Main capture logic, OffscreenCanvas stitching, download via chrome.downloads API
- `content.js` — Page measurement, scroll control, fixed element hiding, state restoration
- `popup.html/js` — Simple UI with capture button and progress bar
- `manifest.json` — Manifest V3

## Permissions

- `activeTab` — Access to current tab for capture
- `scripting` — Inject content.js into pages
- `downloads` — Save screenshot PNG via chrome.downloads API

## Key Constants (background.js)

- `MAX_CANVAS_DIM = 16384` — Chrome canvas size limit
- `CAPTURE_INTERVAL_MS = 500` — Rate limit for captureVisibleTab (~2/sec)
- `SCROLL_SETTLE_MS = 200` — Wait for lazy content after scroll
