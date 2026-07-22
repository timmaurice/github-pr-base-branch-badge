// Send message to background script for storage operations (no direct chrome.storage access)
export function getCachedBranch(prUrl) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action: 'getCachedBranch', prUrl }, (response) => {
        if (response && response.success) {
          resolve(response.branch);
        } else {
          resolve(null);
        }
      });
    } catch {
      resolve(null); // Fallback if messaging fails
    }
  });
}

export function setCachedBranch(prUrl, branch) {
  try {
    chrome.runtime.sendMessage({ action: 'setCachedBranch', prUrl, branch }, (response) => {
      if (response && response.success) {
        // Silent - don't log every storage write
      }
    });
  } catch {
    // Fallback if messaging fails - just continue
  }
}
