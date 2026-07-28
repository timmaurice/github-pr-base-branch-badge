import { i18nReady, I18N_DEFAULT_LANG } from '../shared/i18n.js';
import { setBranchColors, setGithubToken, setUiLanguage } from './state.js';
import { repoKeyFromPath } from '../shared/repoKey.js';

// Colors are looked up in four tiers, most-specific first: this repo's own
// saved colors, the shared template used to seed new repos (see popup.js
// and CLAUDE.md's "Branch colors" section), the pre-per-repo global value
// (sync then local, for installs that haven't opened the popup since that
// migration landed), and finally state.js's hardcoded DEFAULT_COLORS if
// none of those exist yet.
export function loadColorSettings(callback) {
  const repoKey = repoKeyFromPath(window.location.pathname);
  const repoStorageKey = repoKey ? `repoBranchColors:${repoKey}` : null;

  chrome.storage.local.get('branchColors', (localResult) => {
    chrome.storage.sync.get(
      [repoStorageKey, 'repoBranchColorsTemplate', 'branchColors'].filter(Boolean),
      (syncResult) => {
        const colors =
          (repoStorageKey && syncResult[repoStorageKey]) ||
          syncResult.repoBranchColorsTemplate ||
          syncResult.branchColors ||
          localResult.branchColors;
        if (colors) setBranchColors(colors);
        if (callback) callback();
      }
    );
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
