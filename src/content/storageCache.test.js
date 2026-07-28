import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCachedBranch, setCachedBranch } from './storageCache.js';

test('getCachedBranch resolves the branch on a successful response', async () => {
  globalThis.chrome = {
    runtime: {
      sendMessage(message, callback) {
        assert.deepEqual(message, { action: 'getCachedBranch', prUrl: '/o/r/pull/1' });
        callback({ success: true, branch: 'main' });
      }
    }
  };

  assert.equal(await getCachedBranch('/o/r/pull/1'), 'main');
});

test('getCachedBranch resolves null on an unsuccessful response', async () => {
  globalThis.chrome = {
    runtime: {
      sendMessage(message, callback) {
        callback({ success: false, branch: null });
      }
    }
  };

  assert.equal(await getCachedBranch('/o/r/pull/1'), null);
});

test('getCachedBranch resolves null if sendMessage throws synchronously', async () => {
  globalThis.chrome = {
    runtime: {
      sendMessage() {
        throw new Error('Extension context invalidated');
      }
    }
  };

  assert.equal(await getCachedBranch('/o/r/pull/1'), null);
});

test('setCachedBranch sends the branch under a setCachedBranch action', () => {
  let sentMessage;
  globalThis.chrome = {
    runtime: {
      sendMessage(message, callback) {
        sentMessage = message;
        callback({ success: true });
      }
    }
  };

  setCachedBranch('/o/r/pull/1', 'develop');

  assert.deepEqual(sentMessage, {
    action: 'setCachedBranch',
    prUrl: '/o/r/pull/1',
    branch: 'develop'
  });
});

test('setCachedBranch does not throw if sendMessage throws synchronously', () => {
  globalThis.chrome = {
    runtime: {
      sendMessage() {
        throw new Error('Extension context invalidated');
      }
    }
  };

  assert.doesNotThrow(() => setCachedBranch('/o/r/pull/1', 'develop'));
});
