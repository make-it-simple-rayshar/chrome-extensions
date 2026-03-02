# NightShift — Dark Mode Extension

Dark mode for any website using CSS filter inversion (`filter: invert(1) hue-rotate(180deg)`) with counter-inversion for media elements.

## Stack

React + Vite + Tailwind CSS v4 + shadcn/ui (DarkMatter theme)

## Architecture

```
src/popup/ (React)  →  src/background/ (service worker)  →  src/content/ (injected)
  toggle UI              state management                    CSS filter injection
  settings               chrome.storage                      smart detection
                                                             per-site overrides
```

## Files

- `src/popup/App.tsx` — React UI with Button, Card (shadcn/ui)
- `src/background/index.ts` — State management, chrome.storage
- `src/content/index.ts` — CSS filter injection, smart detection, IIFE wrapper
- `src/components/ui/` — shadcn/ui components (button, card)
- `public/manifest.json` — Manifest V3

## Build

Three Vite configs:
- `vite.config.ts` — Popup (React + Tailwind, ES modules)
- `vite.config.background.ts` — Service worker (IIFE, single file)
- `vite.config.content.ts` — Content script (IIFE, single file)

## Permissions

- `storage` — Persist dark mode state and per-site settings
- `host_permissions: ["<all_urls>"]` — Content script injection for all sites

## Key Design Decisions

- **Declarative content scripts** (manifest `content_scripts`) with `run_at: document_start` and `all_frames: true` — prevents FOUC
- **No `scripting` permission** — content script declared in manifest, not programmatically injected
- **IIFE wrapper with `__nightshiftInjected` guard** — prevents double injection
- **CSS filter approach** — `filter: invert(1) hue-rotate(180deg)` on `<html>`, counter-invert media elements
