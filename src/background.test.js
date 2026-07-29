import { test } from 'node:test';
import assert from 'node:assert/strict';

// background.js has no exports — it's a service worker script that registers
// a single onMessage listener as a side effect of being imported. `chrome`
// must exist *before* that import runs, so the mock is set up first and the
// listener is captured via addListener rather than importing named exports.
const listeners = [];
const lifecycleListeners = { onInstalled: [], onStartup: [] };
globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener(fn) {
        listeners.push(fn);
      }
    },
    // background.js also registers pruneExpiredBranchCache() against these
    // on import — captured the same way as onMessage so a test can trigger
    // it explicitly instead of only covering the message-handling path.
    onInstalled: {
      addListener(fn) {
        lifecycleListeners.onInstalled.push(fn);
      }
    },
    onStartup: {
      addListener(fn) {
        lifecycleListeners.onStartup.push(fn);
      }
    },
    getURL(path) {
      return `chrome-extension://test-id/${path}`;
    },
    getManifest() {
      return { version: '1.2.1' };
    }
  }
};

await import('./background.js');
const [handleMessage] = listeners;
const [pruneOnInstalled] = lifecycleListeners.onInstalled;

// Every recognized action returns `true` from the listener to keep the
// sendResponse channel open for its async work; this helper asserts that
// contract on each call instead of repeating it in every test.
function sendMessage(message) {
  return new Promise((resolve) => {
    const returned = handleMessage(message, {}, resolve);
    assert.equal(returned, true);
  });
}

test('getLocaleDict resolves the fetched dictionary for a known language', async () => {
  globalThis.fetch = async (url) => {
    assert.equal(url, 'chrome-extension://test-id/locales/de.json');
    return { json: async () => ({ hello: 'Hallo' }) };
  };

  const response = await sendMessage({ action: 'getLocaleDict', lang: 'de' });
  assert.deepEqual(response, { success: true, dict: { hello: 'Hallo' } });
});

test('getLocaleDict falls back to the English locale file for an unknown language', async () => {
  globalThis.fetch = async (url) => {
    assert.equal(url, 'chrome-extension://test-id/locales/en.json');
    return { json: async () => ({ hello: 'Hello' }) };
  };

  const response = await sendMessage({ action: 'getLocaleDict', lang: 'fr' });
  assert.deepEqual(response, { success: true, dict: { hello: 'Hello' } });
});

test('getLocaleDict resolves an empty dict when the fetch fails', async () => {
  globalThis.fetch = async () => {
    throw new Error('network error');
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await sendMessage({ action: 'getLocaleDict', lang: 'de' });
    assert.deepEqual(response, { success: false, dict: {} });
  } finally {
    console.error = originalConsoleError;
  }
});

test('getCachedBranch resolves the cached branch when still within the 24h TTL', async () => {
  globalThis.chrome.storage = {
    local: {
      get(key, callback) {
        callback({ [key]: { branch: 'main', timestamp: Date.now() - 1000 } });
      },
      remove() {
        assert.fail('should not remove a still-valid cache entry');
      }
    }
  };

  const response = await sendMessage({ action: 'getCachedBranch', prUrl: '/o/r/pull/1' });
  assert.deepEqual(response, { success: true, branch: 'main' });
});

test('getCachedBranch expires and removes an entry older than the 24h TTL', async () => {
  let removedKey;
  globalThis.chrome.storage = {
    local: {
      get(key, callback) {
        callback({ [key]: { branch: 'main', timestamp: Date.now() - 25 * 60 * 60 * 1000 } });
      },
      remove(key) {
        removedKey = key;
      }
    }
  };

  const response = await sendMessage({ action: 'getCachedBranch', prUrl: '/o/r/pull/1' });
  assert.deepEqual(response, { success: false, branch: null });
  assert.equal(removedKey, 'branch_/o/r/pull/1');
});

test('getCachedBranch resolves null when nothing is cached', async () => {
  globalThis.chrome.storage = {
    local: {
      get(key, callback) {
        callback({});
      }
    }
  };

  const response = await sendMessage({ action: 'getCachedBranch', prUrl: '/o/r/pull/1' });
  assert.deepEqual(response, { success: false, branch: null });
});

test('setCachedBranch stores the branch under branch_<prUrl> with a fresh timestamp', async () => {
  let stored;
  globalThis.chrome.storage = {
    local: {
      set(items, callback) {
        stored = items;
        callback();
      }
    }
  };

  const before = Date.now();
  const response = await sendMessage({
    action: 'setCachedBranch',
    prUrl: '/o/r/pull/1',
    branch: 'develop'
  });

  assert.deepEqual(response, { success: true });
  assert.equal(stored['branch_/o/r/pull/1'].branch, 'develop');
  assert.ok(stored['branch_/o/r/pull/1'].timestamp >= before);
});

test('pruneExpiredBranchCache removes only expired branch_ entries', () => {
  const now = Date.now();
  let removedKeys;
  globalThis.chrome.storage = {
    local: {
      get(key, callback) {
        assert.equal(key, null);
        callback({
          'branch_/o/r/pull/1': { branch: 'main', timestamp: now - 1000 }, // fresh
          'branch_/o/r/pull/2': { branch: 'develop', timestamp: now - 25 * 60 * 60 * 1000 }, // expired
          'branch_/o/r/pull/3': {}, // missing timestamp — treated as expired
          uiLanguage: 'en' // unrelated key, must be left alone
        });
      },
      remove(keys) {
        removedKeys = keys;
      }
    }
  };

  pruneOnInstalled();

  assert.deepEqual([...removedKeys].sort(), ['branch_/o/r/pull/2', 'branch_/o/r/pull/3'].sort());
});

test('pruneExpiredBranchCache does not call remove when nothing is expired', () => {
  globalThis.chrome.storage = {
    local: {
      get(key, callback) {
        callback({ 'branch_/o/r/pull/1': { branch: 'main', timestamp: Date.now() } });
      },
      remove() {
        assert.fail('should not remove any entry when nothing is expired');
      }
    }
  };

  pruneOnInstalled();
});

test('checkForUpdate reports a newer release when one is published', async () => {
  let stored;
  globalThis.chrome.storage = {
    local: {
      get(key, callback) {
        callback({});
      },
      set(items) {
        stored = items;
      }
    }
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ tag_name: 'v1.3.0', html_url: 'https://example.com/releases/v1.3.0' })
  });

  const response = await sendMessage({ action: 'checkForUpdate' });
  assert.deepEqual(response, { version: '1.3.0', url: 'https://example.com/releases/v1.3.0' });
  assert.deepEqual(stored.updateCheck.result, response);
});

test('checkForUpdate reports nothing when already on the latest release', async () => {
  globalThis.chrome.storage = {
    local: {
      get(key, callback) {
        callback({});
      },
      set() {}
    }
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ tag_name: 'v1.2.1', html_url: 'https://example.com/releases/v1.2.1' })
  });

  const response = await sendMessage({ action: 'checkForUpdate' });
  assert.equal(response, null);
});

test('checkForUpdate reuses a cached result within the 24h TTL instead of fetching again', async () => {
  globalThis.chrome.storage = {
    local: {
      get(key, callback) {
        callback({
          updateCheck: {
            result: { version: '1.3.0', url: 'https://example.com/releases/v1.3.0' },
            checkedAt: Date.now() - 1000
          }
        });
      }
    }
  };
  globalThis.fetch = async () => {
    assert.fail('should not fetch while the cached result is still fresh');
  };

  const response = await sendMessage({ action: 'checkForUpdate' });
  assert.deepEqual(response, { version: '1.3.0', url: 'https://example.com/releases/v1.3.0' });
});

test('checkForUpdate falls back to the previous cached result when the fetch fails', async () => {
  globalThis.chrome.storage = {
    local: {
      get(key, callback) {
        callback({
          updateCheck: {
            result: { version: '1.3.0', url: 'https://example.com/releases/v1.3.0' },
            checkedAt: Date.now() - 25 * 60 * 60 * 1000
          }
        });
      },
      set() {}
    }
  };
  globalThis.fetch = async () => {
    throw new Error('network error');
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await sendMessage({ action: 'checkForUpdate' });
    assert.deepEqual(response, { version: '1.3.0', url: 'https://example.com/releases/v1.3.0' });
  } finally {
    console.error = originalConsoleError;
  }
});

test('an unrecognized action is ignored without a response', () => {
  let called = false;
  const returned = handleMessage({ action: 'unknown' }, {}, () => {
    called = true;
  });

  assert.equal(called, false);
  assert.equal(returned, undefined);
});
