import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'));

const RELEASE_DIR = 'release';
const STAGE_DIR = `${RELEASE_DIR}/github-pr-base-branch-badge`;
const ZIP_NAME = `github-pr-base-branch-badge-v${version}.zip`;

// Exactly what a "Load unpacked" install needs — mirrors what
// manifest.json/popup.html actually reference, not the whole repo. No
// src/, tests, or tooling configs; icon.svg is the source vector for the
// PNGs and is never loaded by Chrome itself, so it's left out too.
const INCLUDE = [
  'manifest.json',
  'popup.html',
  'dist',
  'locales',
  '_locales',
  'icon16.png',
  'icon48.png',
  'icon128.png'
];

execSync('npm run build', { stdio: 'inherit' });

rmSync(RELEASE_DIR, { recursive: true, force: true });
mkdirSync(STAGE_DIR, { recursive: true });

for (const item of INCLUDE) {
  cpSync(item, `${STAGE_DIR}/${item}`, { recursive: true });
}

// -X strips extended attributes/resource forks so a zip built on macOS
// doesn't ship a __MACOSX/ folder alongside the real contents.
execSync(`zip -r -X "../${ZIP_NAME}" .`, { cwd: STAGE_DIR, stdio: 'inherit' });

rmSync(STAGE_DIR, { recursive: true, force: true });

console.log(`  ${RELEASE_DIR}/${ZIP_NAME}`);
