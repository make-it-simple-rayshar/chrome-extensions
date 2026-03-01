# Chrome Extensions by Rayshar

Turborepo + pnpm monorepo for Chrome extensions.

## Full Page Screenshot

Captures entire web pages — not just the visible area. Click once, and the extension scrolls the page, captures each section, and stitches them into a single high-resolution PNG.

**Install from [Chrome Web Store](https://chrome.google.com/webstore)** (coming soon)

### Features

- **Scrollable containers** — captures SPAs like Gmail, Slack, Notion where content scrolls inside a container
- **Element picker** — click any element to capture just that section; scrollable elements get full scroll-and-stitch
- **Cross-origin iframes** — captures content inside embedded iframes (e.g., Twilio console)
- **Pixel-perfect** — respects display DPR (Retina-ready)
- **Zero data collection** — everything stays on your device, no accounts, no cloud, no tracking

### How it works

1. Click the extension icon
2. Choose **Capture Full Page** or **Select Element**
3. Screenshot saves automatically to Downloads

Uses Chrome's `captureVisibleTab` API with scroll-and-stitch technique and `OffscreenCanvas` for stitching — all in the service worker.

### Permissions

| Permission | Why |
|---|---|
| `activeTab` | Access current tab when you click the button |
| `scripting` | Inject content script to scroll and measure the page |
| `downloads` | Save screenshots to your computer |
| `webNavigation` | Detect iframes for capture |

## Development

### Prerequisites

- Node.js 18+
- pnpm 9+

### Setup

```bash
git clone https://github.com/ArekCzekala/chrome-extensions-rayshar.git
cd chrome-extensions-rayshar
pnpm install
pnpm build
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `apps/full-page-screenshot/dist`

### Commands

```bash
pnpm build          # Build all extensions
pnpm dev            # Watch mode
pnpm lint           # Lint (Biome)
pnpm type-check     # TypeScript check
pnpm package        # ZIP extensions → dist/<name>.zip
```

### Tech stack

- **Manifest V3** — Chrome extension platform
- **React 19 + Vite 6** — popup UI
- **Tailwind CSS v4 + shadcn/ui** — styling (DarkMatter theme)
- **Biome** — linting and formatting
- **Turborepo** — monorepo build orchestration

## Privacy

Full Page Screenshot does not collect, store, or transmit any user data. All processing happens locally in your browser. See [Privacy Policy](docs/privacy-policy.html).

## License

MIT
