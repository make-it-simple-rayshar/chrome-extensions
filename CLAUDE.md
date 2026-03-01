# Chrome Extensions Rayshar — Monorepo

Turborepo + pnpm monorepo for Chrome extensions by Rayshar.

## Architecture

```
apps/           Chrome extensions (each is a standalone Manifest V3 extension)
packages/       Shared code and configs (tsconfig, future shared utils)
scripts/        Build tooling (packaging script)
turbo/          Turborepo generators for scaffolding new extensions
```

## Commands

```bash
pnpm lint              # Lint all extensions (Biome)
pnpm lint:fix          # Auto-fix lint issues
pnpm build             # Build TypeScript extensions (skips vanilla JS)
pnpm package           # ZIP all extensions → dist/<name>.zip
pnpm clean             # Remove build artifacts
pnpm dev               # Watch mode (TypeScript extensions only)
pnpm type-check        # Type-check TypeScript extensions
pnpm gen:extension     # Scaffold a new extension (interactive)
```

Filter to one extension: `turbo run lint --filter=@rayshar/full-page-screenshot`

## Adding a New Extension

Run `pnpm gen:extension` and follow the prompts. This creates:
- `apps/<name>/` with manifest.json, scripts, icons, and CLAUDE.md
- Vanilla JS (default) or TypeScript scaffold
- Proper package.json with lint/package/clean scripts

## Conventions

- **Manifest V3** — all extensions use Chrome Manifest V3
- **Vanilla JS by default** — TypeScript is optional, enabled per-extension via generator
- **Biome** for linting and formatting (single quotes, semicolons, 2-space indent)
- **Package scope**: `@rayshar/<extension-name>`
- **No build step for vanilla JS** — files are loaded directly by Chrome
- **Downloads go through `chrome.downloads` API**, not `<a>` tag hacks

## Per-Extension Scripts

Every extension has: `clean`, `lint`, `lint:fix`, `package`
TypeScript extensions additionally have: `build`, `dev`, `type-check`

## Chrome Extension Patterns

- **Service worker** (`background.js`): No DOM access. Use `chrome.*` APIs only. Runs in background, may be terminated by Chrome at any time.
- **Content script** (`content.js`): Injected into web pages. Has DOM access but limited `chrome.*` API. Always wrap in IIFE with injection guard (`window.__extensionInjected`).
- **Popup** (`popup.html/js`): Extension toolbar popup. Communicates with background via `chrome.runtime.sendMessage`.
- **Message passing**: `chrome.runtime.sendMessage` (popup↔background), `chrome.tabs.sendMessage` (background→content). Return `true` from listener for async `sendResponse`.
