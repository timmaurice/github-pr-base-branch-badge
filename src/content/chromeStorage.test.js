import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageGet, storageSet } from './chromeStorage.js';

test('storageGet passes through to chrome.storage[area].get on success', () => {
  globalThis.chrome = {
    storage: {
      local: {
        get(keys, callback) {
          assert.equal(keys, 'foo');
          callback({ foo: 'bar' });
        }
      }
    }
  };

  let result;
  storageGet('local', 'foo', (r) => {
    result = r;
  });
  assert.deepEqual(result, { foo: 'bar' });
});

test('storageGet resolves an empty object instead of throwing when the extension context is invalidated', () => {
  globalThis.chrome = {
    storage: {
      local: {
        get() {
          throw new Error('Extension context invalidated.');
        }
      }
    }
  };
  const originalConsoleWarn = console.warn;
  console.warn = () => {};
  try {
    let result;
    storageGet('local', 'foo', (r) => {
      result = r;
    });
    assert.deepEqual(result, {});
  } finally {
    console.warn = originalConsoleWarn;
  }
});

test('storageSet passes through to chrome.storage[area].set on success', () => {
  let stored;
  globalThis.chrome = {
    storage: {
      sync: {
        set(items, callback) {
          stored = items;
          callback();
        }
      }
    }
  };

  let called = false;
  storageSet('sync', { foo: 'bar' }, () => {
    called = true;
  });
  assert.deepEqual(stored, { foo: 'bar' });
  assert.equal(called, true);
});

test('storageSet does not throw when the extension context is invalidated', () => {
  globalThis.chrome = {
    storage: {
      local: {
        set() {
          throw new Error('Extension context invalidated.');
        }
      }
    }
  };
  const originalConsoleWarn = console.warn;
  console.warn = () => {};
  try {
    let called = false;
    storageSet('local', { foo: 'bar' }, () => {
      called = true;
    });
    assert.equal(called, true);
  } finally {
    console.warn = originalConsoleWarn;
  }
});

test('storageSet is a no-op when the extension context is invalidated and no callback is given', () => {
  globalThis.chrome = {
    storage: {
      local: {
        set() {
          throw new Error('Extension context invalidated.');
        }
      }
    }
  };
  const originalConsoleWarn = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(() => storageSet('local', { foo: 'bar' }));
  } finally {
    console.warn = originalConsoleWarn;
  }
});
