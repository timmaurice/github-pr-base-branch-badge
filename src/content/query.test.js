import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSelectedBaseBranches, removeBaseFilters, buildQueryForBaseBranches } from './query.js';

// getSelectedBaseBranches reads window.location.search directly with no way
// to inject it, so tests stub a minimal `window` for the duration of each
// assertion rather than changing the function's signature just for tests.
function withWindowSearch(search, fn) {
  const original = globalThis.window;
  globalThis.window = { location: { search } };
  try {
    return fn();
  } finally {
    globalThis.window = original;
  }
}

test('getSelectedBaseBranches parses a single base: token', () => {
  withWindowSearch('?q=is%3Apr+base%3Amain', () => {
    assert.deepEqual(getSelectedBaseBranches(), ['main']);
  });
});

test('getSelectedBaseBranches parses multiple base: tokens (OR-combined)', () => {
  withWindowSearch('?q=is%3Apr+base%3Amaster+base%3Abeta', () => {
    assert.deepEqual(getSelectedBaseBranches(), ['master', 'beta']);
  });
});

test('getSelectedBaseBranches returns an empty array with no base: token', () => {
  withWindowSearch('?q=is%3Apr', () => {
    assert.deepEqual(getSelectedBaseBranches(), []);
  });
});

test('removeBaseFilters strips a single base: token', () => {
  assert.equal(removeBaseFilters('is:pr base:main is:open'), 'is:pr is:open');
});

test('removeBaseFilters strips multiple base: tokens and collapses whitespace', () => {
  assert.equal(removeBaseFilters('is:pr base:main base:beta is:open'), 'is:pr is:open');
});

test('removeBaseFilters is a no-op with no base: token', () => {
  assert.equal(removeBaseFilters('is:pr is:open'), 'is:pr is:open');
});

test('buildQueryForBaseBranches strips filters but keeps the rest of the query when branches is empty', () => {
  assert.equal(buildQueryForBaseBranches([], 'is:pr base:main is:open'), 'is:pr is:open');
});

test('buildQueryForBaseBranches appends base: tokens to an existing query', () => {
  assert.equal(
    buildQueryForBaseBranches(['main', 'beta'], 'is:pr is:open'),
    'is:pr is:open base:main base:beta'
  );
});

test('buildQueryForBaseBranches builds a fresh open-PR query when the original is empty', () => {
  assert.equal(buildQueryForBaseBranches(['main'], ''), 'is:pr base:main is:open');
});

test('buildQueryForBaseBranches preserves is:closed from the original query', () => {
  assert.equal(buildQueryForBaseBranches(['main'], 'is:closed'), 'is:closed base:main');
});
