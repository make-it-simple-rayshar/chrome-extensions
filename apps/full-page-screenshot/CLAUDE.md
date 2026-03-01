# Full Page Screenshot

Captures full-page screenshots using scroll-and-stitch technique with OffscreenCanvas. Supports both document-level scrolling and inner scrollable containers (SPA pattern).

## Stack

React + Vite + Tailwind CSS v4 + shadcn/ui (DarkMatter theme)

## Architecture

```
src/popup/ (React)  →  src/background/ (service worker)  →  src/content/ (injected)
  2 buttons              captureFullPage()                    scroll, measure, hide fixed
  progress bar           OffscreenCanvas stitching            auto-detect containers
                         chrome.downloads.download()          element picker overlay
```

## Flow

### Full Page Capture
1. User clicks "Capture Full Page" in popup
2. Popup sends `START_CAPTURE` to background service worker
3. Background injects content.js, sends `PREPARE_CAPTURE` to frame 0
4. Content script detects scrollable container or uses document-level scrolling
5. Loop: `SCROLL_TO` → wait → `captureVisibleTab()` → draw on OffscreenCanvas
6. In containerMode: crops each capture to container's bounding rect
7. After first frame, `HIDE_FIXED` hides sticky/fixed elements
8. `RESTORE` returns page to original state
9. Canvas → PNG blob → `chrome.downloads.download()`

### Element Picker (universal)
1. User clicks "Select Element" in popup → popup closes
2. Background injects content.js, sends `ACTIVATE_PICKER` to main frame
3. Glass overlay with crosshair cursor appears on page
4. Hovering highlights ANY element under cursor:
   - Green border = static element → single screenshot crop via `captureElement()`
   - Blue border = scrollable container → scroll-and-stitch via `captureFullPage()`
5. Click selects element → `PICKER_RESULT` with `{ isScrollable, targetRect, targetIndex }`
6. Escape cancels → `PICKER_CANCELLED`

Works on cross-origin iframe pages (e.g. Twilio) — user picks the iframe element in main frame, and `captureElement()` crops the viewport screenshot to the iframe's bounding rect without needing access to iframe internals.

## Files

- `src/popup/App.tsx` — React UI with Button, Progress, Card (shadcn/ui)
- `src/background/index.ts` — Capture logic, OffscreenCanvas stitching, containerMode cropping
- `src/content/index.ts` — Page measurement, scroll control, container detection, element picker
- `src/components/ui/` — shadcn/ui components (button, progress, card)
- `public/manifest.json` — Manifest V3

## Build

Three Vite configs:
- `vite.config.ts` — Popup (React + Tailwind, ES modules)
- `vite.config.background.ts` — Service worker (IIFE, single file)
- `vite.config.content.ts` — Content script (IIFE, single file)

## Permissions

- `activeTab` — Access to current tab for capture
- `scripting` — Inject content.js into pages (allFrames: true for cross-origin iframes)
- `downloads` — Save screenshot PNG via chrome.downloads API
- `host_permissions: ["<all_urls>"]` — Required for content script injection into cross-origin iframes (e.g. Twilio console)

## Key Constants (background)

- `MAX_CANVAS_DIM = 16384` — Chrome canvas size limit
- `CAPTURE_INTERVAL_MS = 500` — Rate limit for captureVisibleTab (~2/sec)
- `SCROLL_SETTLE_MS = 200` — Wait for lazy content after scroll
- `SEND_TIMEOUT_MS = 10_000` — Timeout for `sendToTab()` to prevent hanging on unresponsive frames

## Architecture Principles

- **`sendToTab()` always requires explicit `frameId`** — never broadcast to all frames
- **`captureFullPage(targetIndex?, frameId=0)`** — frameId is a parameter, no global mutable state
- **Message handler is stateless** — no shared state between `START_CAPTURE` and `PICKER_RESULT`
