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

  plop.setGenerator('extension', {
    description: 'Create a new Chrome extension',
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
        name: 'useTypeScript',
        message: 'Use TypeScript?',
        default: false,
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

      // Always: package.json, manifest.json, CLAUDE.md
      actions.push(
        {
          type: 'add',
          path: `${base}/package.json`,
          templateFile: 'templates/extension/package.json.hbs',
        },
        {
          type: 'add',
          path: `${base}/manifest.json`,
          templateFile: 'templates/extension/manifest.json.hbs',
        },
        {
          type: 'add',
          path: `${base}/CLAUDE.md`,
          templateFile: 'templates/extension/CLAUDE.md.hbs',
        },
      );

      // Icons (copy placeholders)
      for (const size of ['16', '48', '128']) {
        actions.push({
          type: 'add',
          path: `${base}/icons/icon${size}.png`,
          templateFile: `templates/extension/icons/icon${size}.png`,
        });
      }

      // Popup
      if (answers.hasPopup) {
        actions.push({
          type: 'add',
          path: `${base}/popup.html`,
          templateFile: 'templates/extension/popup.html.hbs',
        });
        const ext = answers.useTypeScript ? 'ts' : 'js';
        actions.push({
          type: 'add',
          path: `${base}/popup.${ext}`,
          templateFile: `templates/extension/popup.${ext}.hbs`,
        });
      }

      // Background
      if (answers.hasBackground) {
        const ext = answers.useTypeScript ? 'ts' : 'js';
        actions.push({
          type: 'add',
          path: `${base}/background.${ext}`,
          templateFile: `templates/extension/background.${ext}.hbs`,
        });
      }

      // Content script
      if (answers.hasContentScript) {
        const ext = answers.useTypeScript ? 'ts' : 'js';
        actions.push({
          type: 'add',
          path: `${base}/content.${ext}`,
          templateFile: `templates/extension/content.${ext}.hbs`,
        });
      }

      // TypeScript config
      if (answers.useTypeScript) {
        actions.push({
          type: 'add',
          path: `${base}/tsconfig.json`,
          templateFile: 'templates/extension/tsconfig.json.hbs',
        });
      }

      return actions;
    },
  });
}
