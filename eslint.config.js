const js = require('@eslint/js');
const globals = require('globals');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions
      }
    },
    rules: {
      // No bundler/module system here — every top-level function/const is a
      // de facto cross-file export picked up via <script> tag order, so
      // "unused" at the top level is expected and shouldn't be flagged.
      // Function-local unused vars are still caught.
      'no-unused-vars': ['error', { vars: 'local' }]
    }
  },
  {
    // i18n.js is loaded before content.js/popup.js via plain <script> tags
    // (no bundler, no import/export — see manifest.json's content_scripts
    // order and popup.html's script tags), so these are real cross-file
    // globals there, but not inside i18n.js itself where they're declared.
    files: ['content.js', 'popup.js'],
    languageOptions: {
      globals: {
        I18N_DEFAULT_LANG: 'readonly',
        i18nReady: 'readonly',
        i18nText: 'readonly'
      }
    }
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    }
  },
  prettierConfig
];
