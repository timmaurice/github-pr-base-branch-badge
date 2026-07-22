// Background script for storage access
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

    chrome.storage.local.set({
      [`branch_${prUrl}`]: {
        branch,
        timestamp: Date.now()
      }
    }, () => {
      sendResponse({ success: true });
    });

    return true; // Keep channel open for async response
  }
});
