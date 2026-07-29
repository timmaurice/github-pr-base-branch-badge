import { i18nReady, I18N_DEFAULT_LANG } from '../shared/i18n.js';
import { setBranchColors, setGithubToken, setUiLanguage } from './state.js';
import { repoKeyFromPagePath } from '../shared/repoKey.js';
import { storageGet } from './chromeStorage.js';

// Fallback chain (repo → template → legacy global → DEFAULT_COLORS) — see
// CLAUDE.md's "Branch colors" section.
export function loadColorSettings(callback) {
  const repoKey = repoKeyFromPagePath(window.location.pathname);
  const repoStorageKey = repoKey ? `repoBranchColors:${repoKey}` : null;

  storageGet('local', 'branchColors', (localResult) => {
    storageGet(
      'sync',
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
  storageGet('local', 'githubToken', (result) => {
    setGithubToken(result.githubToken || '');
    if (callback) callback();
  });
}

export function loadUiLanguage(callback) {
  storageGet('local', 'uiLanguage', (localResult) => {
    storageGet('sync', 'uiLanguage', (syncResult) => {
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
