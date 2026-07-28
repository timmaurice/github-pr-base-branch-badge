import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoKeyFromPath } from './repoKey.js';

test('repoKeyFromPath extracts owner/repo from a pulls list page', () => {
  assert.equal(repoKeyFromPath('/home-assistant/core/pulls'), 'home-assistant/core');
});

test('repoKeyFromPath extracts owner/repo from a pull detail page', () => {
  assert.equal(repoKeyFromPath('/home-assistant/core/pull/123'), 'home-assistant/core');
});

test('repoKeyFromPath extracts owner/repo from an issues page', () => {
  assert.equal(repoKeyFromPath('/home-assistant/core/issues'), 'home-assistant/core');
});

test('repoKeyFromPath returns null for a bare repo home page', () => {
  assert.equal(repoKeyFromPath('/home-assistant/core'), null);
});

test("repoKeyFromPath returns null for GitHub's own non-repo routes", () => {
  assert.equal(repoKeyFromPath('/settings/profile'), null);
  assert.equal(repoKeyFromPath('/notifications'), null);
});
