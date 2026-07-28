import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoveredBranches, loadDiscoveredBranches, rememberDiscoveredBranch } from './state.js';

// discoveredBranches is a module-level Set shared by every test in this
// file (state.js has no reset hook) — each test clears it up front rather
// than relying on run order.

test('rememberDiscoveredBranch adds a new branch and persists the full set', () => {
  discoveredBranches.clear();
  let persisted;
  globalThis.chrome = {
    storage: {
      local: {
        set(items) {
          persisted = items.discoveredBranches;
        }
      }
    }
  };

  rememberDiscoveredBranch('main');

  assert.deepEqual([...discoveredBranches], ['main']);
  assert.deepEqual(persisted, ['main']);
});

test('rememberDiscoveredBranch does not write to storage again for an already-known branch', () => {
  discoveredBranches.clear();
  let setCalls = 0;
  globalThis.chrome = {
    storage: {
      local: {
        set() {
          setCalls++;
        }
      }
    }
  };

  rememberDiscoveredBranch('main');
  rememberDiscoveredBranch('main');

  assert.equal(setCalls, 1);
  assert.deepEqual([...discoveredBranches], ['main']);
});

test('loadDiscoveredBranches merges persisted branches into the in-memory set', () => {
  discoveredBranches.clear();
  globalThis.chrome = {
    storage: {
      local: {
        get(key, callback) {
          assert.equal(key, 'discoveredBranches');
          callback({ discoveredBranches: ['develop', 'staging'] });
        }
      }
    }
  };

  loadDiscoveredBranches();

  assert.deepEqual([...discoveredBranches].sort(), ['develop', 'staging']);
});

test('loadDiscoveredBranches tolerates no persisted value', () => {
  discoveredBranches.clear();
  globalThis.chrome = {
    storage: {
      local: {
        get(key, callback) {
          callback({});
        }
      }
    }
  };

  loadDiscoveredBranches();

  assert.deepEqual([...discoveredBranches], []);
});
