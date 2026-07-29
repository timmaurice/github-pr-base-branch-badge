// Chrome invalidates a content script's extension context when the
// extension is reloaded/updated while a tab stays open (dev "reload" in
// chrome://extensions, or a real update landing on a user's machine) — every
// chrome.storage.*/chrome.runtime.* call in that orphaned script then throws
// "Extension context invalidated" SYNCHRONOUSLY, not as a rejected promise.
// storageCache.js already guards its chrome.runtime.sendMessage calls the
// same way; these wrappers give state.js/settings.js's chrome.storage.get/set
// calls the same protection, since GitHub's own page keeps working and
// nothing should throw an uncaught error just because our own storage read
// failed. A single console.warn (not one per call) tells the user to reload
// the tab instead of silently doing nothing forever.
let warned = false;

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn(
    'Base Branch Badge: extension was updated or reloaded — reload this tab to restore badges/filtering.'
  );
}

export function storageGet(area, keys, callback) {
  try {
    chrome.storage[area].get(keys, callback);
  } catch {
    warnOnce();
    callback({});
  }
}

export function storageSet(area, items, callback) {
  try {
    chrome.storage[area].set(items, callback);
  } catch {
    warnOnce();
    if (callback) callback();
  }
}
