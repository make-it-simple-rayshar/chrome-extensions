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
pnpm test              # Run tests (Vitest) across all extensions
pnpm quality           # type-check + lint + test in one command
pnpm gen:extension     # Scaffold a new extension (interactive)
```

Filter to one extension: `turbo run lint --filter=@rayshar/full-page-screenshot`

## Adding a New Extension

Run `pnpm gen:extension` and follow the prompts. This creates:
- `apps/<name>/` with React + Vite + Tailwind + shadcn/ui (DarkMatter theme)
- Three Vite builds: popup (React), background (IIFE), content (IIFE)
- shadcn/ui components (Button, Card) + DarkMatter theme auto-installed
- Vitest config with `passWithNoTests` enabled
- Proper package.json with build/dev/lint/test/package scripts

## Conventions

- **Manifest V3** — all extensions use Chrome Manifest V3
- **React + Vite + Tailwind + shadcn/ui** — all extensions use this stack
- **DarkMatter theme** — default shadcn theme from tweakcn
- **Vitest** for unit testing (`src/**/*.test.ts`)
- **Biome** for linting and formatting (single quotes, semicolons, 2-space indent)
- **Lefthook** for git hooks (pre-commit: type-check + lint + test, commit-msg: commitlint)
- **Commitlint** — conventional commits required (`feat:`, `fix:`, `chore:`, etc.) with scoped packages
- **Package scope**: `@rayshar/<extension-name>`
- **Downloads go through `chrome.downloads` API**, not `<a>` tag hacks

## Per-Extension Scripts

Every extension has: `build`, `dev`, `type-check`, `clean`, `lint`, `lint:fix`, `test`, `test:watch`, `test:coverage`, `package`

## Chrome Extension Patterns

- **Service worker** (`src/background/index.ts`): No DOM access. Use `chrome.*` APIs only. Built as IIFE via `vite.config.background.ts`.
- **Content script** (`src/content/index.ts`): Injected into web pages. Has DOM access but limited `chrome.*` API. Always wrap in IIFE with injection guard. Built as IIFE via `vite.config.content.ts`.
- **Popup** (`src/popup/`): React UI with shadcn/ui components. Communicates with background via `chrome.runtime.sendMessage`. Built via `vite.config.ts`.
- **Message passing**: `chrome.runtime.sendMessage` (popup↔background), `chrome.tabs.sendMessage` (background→content). Return `true` from listener for async `sendResponse`.
