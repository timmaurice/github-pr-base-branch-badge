import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustColor, resolveBranchColor, getContrastTextColor } from './utils.js';

test('adjustColor brightens each channel, clamped at 255', () => {
  assert.equal(adjustColor('#000000', 20), '#141414');
  assert.equal(adjustColor('#f0f0f0', 20), '#ffffff');
});

test('adjustColor darkens each channel, clamped at 0', () => {
  assert.equal(adjustColor('#3b82f6', -20), '#276ee2');
  assert.equal(adjustColor('#000000', -20), '#000000');
});

test('resolveBranchColor prefers an exact match over a wildcard pattern', () => {
  const colors = { 'in*': '#f97316', int: '#111111', default: '#6b7280' };
  assert.equal(resolveBranchColor(colors, 'int'), '#111111');
});

test('resolveBranchColor matches a `*`-suffixed wildcard pattern', () => {
  const colors = { 'in*': '#f97316', default: '#6b7280' };
  assert.equal(resolveBranchColor(colors, 'integration'), '#f97316');
});

test('resolveBranchColor matches a `*`-prefixed and mid-string wildcard pattern', () => {
  const colors = { '*-staging': '#f97316', 'release/*/hotfix': '#111111', default: '#6b7280' };
  assert.equal(resolveBranchColor(colors, 'v24.x-staging'), '#f97316');
  assert.equal(resolveBranchColor(colors, 'release/1.2/hotfix'), '#111111');
});

test('resolveBranchColor picks the first matching pattern in insertion order when several match', () => {
  const colors = { 'release/*': '#222222', '*': '#111111', default: '#6b7280' };
  assert.equal(resolveBranchColor(colors, 'release/1.2'), '#222222');
});

test('resolveBranchColor lets an earlier, less specific pattern win over a later, more specific one', () => {
  const colors = { '*': '#111111', 'release/*': '#222222', default: '#6b7280' };
  assert.equal(resolveBranchColor(colors, 'release/1.2'), '#111111');
});

test('resolveBranchColor falls back to default when nothing matches', () => {
  const colors = { 'in*': '#f97316', default: '#6b7280' };
  assert.equal(resolveBranchColor(colors, 'main'), '#6b7280');
});

test('resolveBranchColor treats regex special characters in patterns literally', () => {
  const colors = { 'v1.2': '#111111', default: '#6b7280' };
  assert.equal(resolveBranchColor(colors, 'v1x2'), '#6b7280');
  assert.equal(resolveBranchColor(colors, 'v1.2'), '#111111');
});

test('getContrastTextColor picks dark text on a light background', () => {
  assert.equal(getContrastTextColor('#f0f0f0'), '#1f2937');
  assert.equal(getContrastTextColor('#ffff00'), '#1f2937');
});

test('getContrastTextColor picks white text on a dark/saturated background', () => {
  assert.equal(getContrastTextColor('#000000'), '#ffffff');
  assert.equal(getContrastTextColor('#3b82f6'), '#ffffff');
});
