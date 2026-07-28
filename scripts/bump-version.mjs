import { readFileSync, writeFileSync } from 'node:fs';

// Keeps manifest.json (the source of truth CI checks release tags against —
// see .github/workflows/release.yml) and package.json in lockstep, so they
// never drift apart. Only rewrites the "version" field; nothing else in
// either file changes.

const VALID_KEYWORDS = ['major', 'minor', 'patch'];
const SEMVER = /^\d+\.\d+\.\d+$/;

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeVersion(file, version) {
  const json = readJson(file);
  json.version = version;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

function nextVersion(current, arg) {
  if (SEMVER.test(arg)) return arg;

  if (!VALID_KEYWORDS.includes(arg)) {
    throw new Error(`"${arg}" is neither major/minor/patch nor a plain X.Y.Z version`);
  }

  const [major, minor, patch] = current.split('.').map(Number);
  if (arg === 'major') return `${major + 1}.0.0`;
  if (arg === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npm run version:bump -- <major|minor|patch|X.Y.Z>');
  process.exit(1);
}

const manifest = readJson('manifest.json');
const pkg = readJson('package.json');

if (manifest.version !== pkg.version) {
  console.warn(
    `Warning: manifest.json (${manifest.version}) and package.json (${pkg.version}) were already out of sync — bumping both from manifest.json's version.`
  );
}

let next;
try {
  next = nextVersion(manifest.version, arg);
} catch (error) {
  console.error(error.message);
  console.error('Usage: npm run version:bump -- <major|minor|patch|X.Y.Z>');
  process.exit(1);
}

writeVersion('manifest.json', next);
writeVersion('package.json', next);

console.log(`Bumped version: ${manifest.version} → ${next}`);
console.log('Next steps:');
console.log('  npm run format');
console.log('  git add manifest.json package.json');
console.log(`  git commit -m "Bump version to ${next}"`);
console.log(`  git tag v${next}`);
console.log('  git push && git push --tags');
