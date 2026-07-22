import { i18nReady, I18N_DEFAULT_LANG } from '../shared/i18n.js';
import { setBranchColors, setGithubToken, setUiLanguage } from './state.js';

// Load colors from storage
export function loadColorSettings(callback) {
  chrome.storage.local.get('branchColors', (result) => {
    if (result.branchColors) {
      setBranchColors(result.branchColors);
    }
    if (callback) callback();
  });
}

export function loadGithubToken(callback) {
  chrome.storage.local.get('githubToken', (result) => {
    setGithubToken(result.githubToken || '');
    if (callback) callback();
  });
}

export function loadUiLanguage(callback) {
  chrome.storage.local.get('uiLanguage', (result) => {
    const lang = result.uiLanguage || I18N_DEFAULT_LANG;
    setUiLanguage(lang);
    // Fetches locales/*.json (see shared/i18n.js) before calling back — every
    // existing caller already treats loadUiLanguage as async, so this just
    // extends what "ready" means without touching call sites.
    i18nReady(lang, () => {
      if (callback) callback();
    });
  });
}
