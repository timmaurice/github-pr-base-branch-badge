import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustColor } from './utils.js';

test('adjustColor brightens each channel, clamped at 255', () => {
  assert.equal(adjustColor('#000000', 20), '#141414');
  assert.equal(adjustColor('#f0f0f0', 20), '#ffffff');
});

test('adjustColor darkens each channel, clamped at 0', () => {
  assert.equal(adjustColor('#3b82f6', -20), '#276ee2');
  assert.equal(adjustColor('#000000', -20), '#000000');
});
