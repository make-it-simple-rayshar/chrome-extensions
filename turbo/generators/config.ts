import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { PlopTypes } from '@turbo/gen';

function toTitleCase(str: string): string {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setHelper('json-permissions', (context: string[]) => {
    if (!Array.isArray(context) || context.length === 0) return '';
    return context.map((item) => `"${item}"`).join(', ');
  });

  plop.setActionType('setup-shadcn', (answers) => {
    const cwd = resolve('apps', answers.name as string);
    const root = resolve('.');

    // Install dependencies first
    execFileSync('pnpm', ['install'], { cwd: root, stdio: 'inherit' });

    // Initialize shadcn with defaults
    execFileSync('pnpm', ['dlx', 'shadcn@latest', 'init', '--yes', '--defaults'], {
      cwd,
      stdio: 'inherit',
    });

    // Install DarkMatter theme
    execFileSync(
      'pnpm',
      ['dlx', 'shadcn@latest', 'add', 'https://tweakcn.com/r/themes/darkmatter.json'],
      { cwd, stdio: 'inherit', input: 'y\n' },
    );

    // Add base UI components
    execFileSync('pnpm', ['dlx', 'shadcn@latest', 'add', 'button', 'card'], {
      cwd,
      stdio: 'inherit',
    });

    return 'shadcn setup complete';
  });

  plop.setGenerator('extension', {
    description: 'Create a new Chrome extension (React + Vite + shadcn)',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Extension name (kebab-case, e.g. tab-manager):',
        validate: (input: string) => {
          if (/^[a-z][a-z0-9-]*$/.test(input)) return true;
          return 'Name must be kebab-case (lowercase letters, numbers, hyphens)';
        },
      },
      {
        type: 'input',
        name: 'displayName',
        message: 'Display name for Chrome Web Store:',
        default: (answers: { name: string }) => toTitleCase(answers.name),
      },
      {
        type: 'input',
        name: 'description',
        message: 'Short description:',
        default: 'A Chrome extension',
      },
      {
        type: 'checkbox',
        name: 'permissions',
        message: 'Chrome permissions:',
        choices: [
          { name: 'activeTab', checked: true },
          { name: 'tabs' },
          { name: 'storage' },
          { name: 'scripting' },
          { name: 'downloads' },
          { name: 'notifications' },
          { name: 'alarms' },
          { name: 'contextMenus' },
        ],
      },
      {
        type: 'confirm',
        name: 'hasPopup',
        message: 'Include popup UI?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'hasBackground',
        message: 'Include background service worker?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'hasContentScript',
        message: 'Include content script?',
        default: false,
      },
    ],
    actions: (answers) => {
      if (!answers) return [];
      const actions: PlopTypes.ActionType[] = [];
      const base = 'apps/{{ name }}';

      // Always: package.json, tsconfig.json, manifest.json, CLAUDE.md
      actions.push(
        {
          type: 'add',
          path: `${base}/package.json`,
          templateFile: 'templates/extension/package.json.hbs',
        },
        {
          type: 'add',
          path: `${base}/tsconfig.json`,
          templateFile: 'templates/extension/tsconfig.json.hbs',
        },
        {
          type: 'add',
          path: `${base}/public/manifest.json`,
          templateFile: 'templates/extension/manifest.json.hbs',
        },
        {
          type: 'add',
          path: `${base}/CLAUDE.md`,
          templateFile: 'templates/extension/CLAUDE.md.hbs',
        },
      );

      // Icons (copy to public/)
      for (const size of ['16', '48', '128']) {
        actions.push({
          type: 'add',
          path: `${base}/public/icons/icon${size}.png`,
          templateFile: `templates/extension/icons/icon${size}.png`,
        });
      }

      // Popup (always React + Vite)
      if (answers.hasPopup) {
        actions.push(
          {
            type: 'add',
            path: `${base}/popup.html`,
            templateFile: 'templates/extension/popup.html.hbs',
          },
          {
            type: 'add',
            path: `${base}/vite.config.ts`,
            templateFile: 'templates/extension/vite.config.ts.hbs',
          },
          {
            type: 'add',
            path: `${base}/src/popup/main.tsx`,
            templateFile: 'templates/extension/src/popup/main.tsx.hbs',
          },
          {
            type: 'add',
            path: `${base}/src/popup/App.tsx`,
            templateFile: 'templates/extension/src/popup/App.tsx.hbs',
          },
          {
            type: 'add',
            path: `${base}/src/popup/index.css`,
            templateFile: 'templates/extension/src/popup/index.css.hbs',
          },
        );
      }

      // Background service worker (IIFE build)
      if (answers.hasBackground) {
        actions.push(
          {
            type: 'add',
            path: `${base}/vite.config.background.ts`,
            templateFile: 'templates/extension/vite.config.background.ts.hbs',
          },
          {
            type: 'add',
            path: `${base}/src/background/index.ts`,
            templateFile: 'templates/extension/src/background/index.ts.hbs',
          },
        );
      }

      // Content script (IIFE build)
      if (answers.hasContentScript) {
        actions.push(
          {
            type: 'add',
            path: `${base}/vite.config.content.ts`,
            templateFile: 'templates/extension/vite.config.content.ts.hbs',
          },
          {
            type: 'add',
            path: `${base}/src/content/index.ts`,
            templateFile: 'templates/extension/src/content/index.ts.hbs',
          },
        );
      }

      // Phase 2: shadcn init + components + DarkMatter theme
      actions.push({ type: 'setup-shadcn' } as PlopTypes.ActionType);

      return actions;
    },
  });
}
