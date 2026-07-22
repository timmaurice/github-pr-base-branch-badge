// Loader/lookup for the per-language JSON files in locales/*.json. JSON has
// no room for the interpolation functions the old i18n.js used, so strings
// with dynamic parts use {placeholder} tokens instead, filled in by
// i18nText()'s optional third argument (a plain object, e.g. { branch: x }).
//
// Loaded before content.js/popup.js (see manifest.json content_scripts order
// and popup.html's script tags). Both callers already gate their first
// render behind an async chrome.storage.local.get callback (loadUiLanguage),
// so i18nReady() slots into that same pattern rather than adding a new one.
//
// The actual fetch of locales/*.json happens in background.js, not here:
// content scripts inherit the host page's CSP for fetch()/XHR, and GitHub's
// CSP blocks a direct fetch to the chrome-extension:// URL (confirmed by a
// "failed to load locale" error in the page console). The service worker
// isn't subject to that CSP, so this file just messages it and caches the
// result — mirrors the existing getCachedBranch/setCachedBranch pattern.
//
// To add a language: create locales/<code>.json with the same keys as
// locales/en.json, register it in background.js's LOCALE_FILES map, and add
// an <option> in popup.html's #language-select.
const I18N_DEFAULT_LANG = 'en';

// In-memory cache of fetched dictionaries, keyed by language code — a page
// (content script) or popup instance only ever fetches each language once,
// even across repeated language switches.
const I18N_CACHE = {};

function i18nFetchDict(lang, callback) {
  if (I18N_CACHE[lang]) {
    callback(I18N_CACHE[lang]);
    return;
  }

  try {
    chrome.runtime.sendMessage({ action: 'getLocaleDict', lang }, (response) => {
      const dict = response && response.success ? response.dict : {};
      I18N_CACHE[lang] = dict;
      callback(dict);
    });
  } catch {
    callback({});
  }
}

// Ensures both `lang`'s dictionary AND the default-language dictionary are
// cached before calling back — the default acts as a fallback for any key
// missing from `lang` (e.g. a language file mid-translation).
function i18nReady(lang, callback) {
  i18nFetchDict(I18N_DEFAULT_LANG, () => {
    if (lang === I18N_DEFAULT_LANG) {
      callback();
      return;
    }
    i18nFetchDict(lang, () => callback());
  });
}

function i18nInterpolate(template, args) {
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(args, name) ? args[name] : match
  );
}

// Synchronous lookup — safe to call once i18nReady() has fired for `lang`.
function i18nText(lang, key, args) {
  const dict = I18N_CACHE[lang] || {};
  const fallbackDict = I18N_CACHE[I18N_DEFAULT_LANG] || {};
  const template = key in dict ? dict[key] : fallbackDict[key];
  if (template == null) {
    console.warn(`Base Branch Badge: missing i18n key "${key}" for locale "${lang}"`);
    return '';
  }
  return args ? i18nInterpolate(template, args) : template;
}
