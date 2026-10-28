import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBranchPatterns, isBranchIgnored } from './branchPatterns.js';

test('parseBranchPatterns splits on commas and whitespace, dropping empties', () => {
  assert.deepEqual(parseBranchPatterns(' release/*, feature/*\n hotfix/* ,,'), [
    'release/*',
    'feature/*',
    'hotfix/*'
  ]);
});

test('parseBranchPatterns deduplicates and tolerates empty input', () => {
  assert.deepEqual(parseBranchPatterns('main main'), ['main']);
  assert.deepEqual(parseBranchPatterns(''), []);
  assert.deepEqual(parseBranchPatterns(undefined), []);
});

test('isBranchIgnored matches wildcard patterns', () => {
  const patterns = ['release/*', 'feature/*'];
  assert.equal(isBranchIgnored(patterns, 'release/MLP-1.6.10'), true);
  assert.equal(isBranchIgnored(patterns, 'feature/AMCRM-6051'), true);
  assert.equal(isBranchIgnored(patterns, 'main'), false);
});

test('isBranchIgnored treats a pattern without * as an exact name', () => {
  assert.equal(isBranchIgnored(['qas'], 'qas'), true);
  assert.equal(isBranchIgnored(['qas'], 'qas-old'), false);
});

test('isBranchIgnored escapes regex characters in patterns', () => {
  assert.equal(isBranchIgnored(['release/1.6.*'], 'release/1.6.10'), true);
  assert.equal(isBranchIgnored(['release/1.6.*'], 'release/1x6.10'), false);
});

test('isBranchIgnored with no patterns ignores nothing', () => {
  assert.equal(isBranchIgnored([], 'main'), false);
  assert.equal(isBranchIgnored(undefined, 'main'), false);
});
