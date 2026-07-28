// Loader/lookup for the per-language JSON files in locales/*.json — strings
// with dynamic parts use {placeholder} tokens, filled in by i18nText()'s
// optional third argument. Fetching happens in background.js, not here (see
// CLAUDE.md's "UI language / i18n" section for why); this file just messages
// it and caches the result.
export const I18N_DEFAULT_LANG = 'en';

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
export function i18nReady(lang, callback) {
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
export function i18nText(lang, key, args) {
  const dict = I18N_CACHE[lang] || {};
  const fallbackDict = I18N_CACHE[I18N_DEFAULT_LANG] || {};
  const template = key in dict ? dict[key] : fallbackDict[key];
  if (template == null) {
    console.warn(`Base Branch Badge: missing i18n key "${key}" for locale "${lang}"`);
    return '';
  }
  return args ? i18nInterpolate(template, args) : template;
}
