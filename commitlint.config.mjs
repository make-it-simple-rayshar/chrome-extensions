export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['full-page-screenshot', 'nightshift', 'tsconfig', 'monorepo'],
    ],
    'scope-empty': [1, 'never'],
  },
};
