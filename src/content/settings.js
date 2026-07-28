import { i18nReady, I18N_DEFAULT_LANG } from '../shared/i18n.js';
import { setBranchColors, setGithubToken, setUiLanguage } from './state.js';

// branchColors/uiLanguage are read from storage.sync first (see popup.js and
// CLAUDE.md), falling back to storage.local for installs that haven't saved
// since sync support landed (the popup migrates local → sync on next open,
// but a content script can load before that migration has run).
export function loadColorSettings(callback) {
  chrome.storage.local.get('branchColors', (localResult) => {
    chrome.storage.sync.get('branchColors', (syncResult) => {
      const colors = syncResult.branchColors || localResult.branchColors;
      if (colors) setBranchColors(colors);
      if (callback) callback();
    });
  });
}

export function loadGithubToken(callback) {
  chrome.storage.local.get('githubToken', (result) => {
    setGithubToken(result.githubToken || '');
    if (callback) callback();
  });
}

export function loadUiLanguage(callback) {
  chrome.storage.local.get('uiLanguage', (localResult) => {
    chrome.storage.sync.get('uiLanguage', (syncResult) => {
      const lang = syncResult.uiLanguage || localResult.uiLanguage || I18N_DEFAULT_LANG;
      setUiLanguage(lang);
      // Fetches locales/*.json (see shared/i18n.js) before calling back —
      // every existing caller already treats loadUiLanguage as async, so
      // this just extends what "ready" means without touching call sites.
      i18nReady(lang, () => {
        if (callback) callback();
      });
    });
  });
}
