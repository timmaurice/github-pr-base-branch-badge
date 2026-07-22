import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I18N_DEFAULT_LANG, i18nReady, i18nText } from './i18n.js';

// i18n.js caches fetched dictionaries at module scope with no reset hook, so
// every test in this file shares one fixed dictionary set — swapping dict
// content per test would leak stale cached entries across tests since a
// language is only ever fetched once per process.
const DICTS = {
  en: { hello: 'Hello', greet: 'Hi {name}!', onlyEn: 'only in EN' },
  de: { hello: 'Hallo' }
};

globalThis.chrome = {
  runtime: {
    sendMessage(message, callback) {
      callback({ success: true, dict: DICTS[message.lang] || {} });
    }
  }
};

test('i18nText returns the requested language string', async () => {
  await new Promise((resolve) => i18nReady('de', resolve));
  assert.equal(i18nText('de', 'hello'), 'Hallo');
});

test('i18nText falls back to the default language for a key missing from the target locale', async () => {
  await new Promise((resolve) => i18nReady('de', resolve));
  assert.equal(i18nText('de', 'onlyEn'), 'only in EN');
});

test('i18nText interpolates {placeholder} tokens', async () => {
  await new Promise((resolve) => i18nReady(I18N_DEFAULT_LANG, resolve));
  assert.equal(i18nText(I18N_DEFAULT_LANG, 'greet', { name: 'Ada' }), 'Hi Ada!');
});

test('i18nText returns an empty string for a key missing everywhere', async () => {
  await new Promise((resolve) => i18nReady(I18N_DEFAULT_LANG, resolve));
  assert.equal(i18nText(I18N_DEFAULT_LANG, 'nope'), '');
});
