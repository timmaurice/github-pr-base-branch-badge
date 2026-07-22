// Background script for storage access and locale loading
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const LOCALE_FILES = {
  en: 'locales/en.json',
  de: 'locales/de.json'
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getLocaleDict') {
    // Fetched here rather than in content.js: content scripts inherit the
    // host page's CSP for fetch()/XHR, and GitHub's CSP blocks the request
    // to the chrome-extension:// URL. The service worker isn't subject to
    // that page CSP, so it fetches the bundled JSON and relays it back.
    const path = LOCALE_FILES[message.lang] || LOCALE_FILES.en;

    fetch(chrome.runtime.getURL(path))
      .then((response) => response.json())
      .then((dict) => sendResponse({ success: true, dict }))
      .catch((err) => {
        console.error(`Base Branch Badge: failed to load locale "${message.lang}"`, err);
        sendResponse({ success: false, dict: {} });
      });

    return true; // Keep channel open for async response
  }

  if (message.action === 'getCachedBranch') {
    const { prUrl } = message;

    chrome.storage.local.get(`branch_${prUrl}`, (result) => {
      const data = result[`branch_${prUrl}`];

      if (data && data.timestamp) {
        // Check if cache is still valid
        if (Date.now() - data.timestamp < CACHE_TTL) {
          sendResponse({ success: true, branch: data.branch });
        } else {
          // Cache expired
          chrome.storage.local.remove(`branch_${prUrl}`);
          sendResponse({ success: false, branch: null });
        }
      } else {
        sendResponse({ success: false, branch: null });
      }
    });

    return true; // Keep channel open for async response
  }

  if (message.action === 'setCachedBranch') {
    const { prUrl, branch } = message;

    chrome.storage.local.set(
      {
        [`branch_${prUrl}`]: {
          branch,
          timestamp: Date.now()
        }
      },
      () => {
        sendResponse({ success: true });
      }
    );

    return true; // Keep channel open for async response
  }
});
