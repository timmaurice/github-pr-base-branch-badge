import { build, context } from 'esbuild';
import * as sass from 'sass';
import { mkdirSync, writeFileSync, watch } from 'node:fs';

const DIST_DIR = 'dist';
const SCSS_DIR = 'src/styles';
const SCSS_ENTRY = `${SCSS_DIR}/index.scss`;
const CSS_OUTPUT = `${DIST_DIR}/styles.css`;

// Object-form entryPoints maps each key to the output basename, so these
// land in dist/ as content.js/background.js/popup.js — manifest.json and
// popup.html reference dist/<name>.js directly.
const jsOptions = {
  entryPoints: {
    content: 'src/content/index.js',
    background: 'src/background.js',
    popup: 'src/popup.js'
  },
  bundle: true,
  outdir: DIST_DIR,
  // Content scripts registered via manifest.json can't be declared
  // type: "module" (only dynamic import() works there, not static
  // import/export) — bundling to a plain IIFE is what makes real ES
  // modules usable for the source in src/ at all.
  format: 'iife',
  target: 'chrome100',
  logLevel: 'info'
};

function buildCss() {
  const result = sass.compile(SCSS_ENTRY, { style: 'expanded' });
  mkdirSync(DIST_DIR, { recursive: true });
  writeFileSync(CSS_OUTPUT, result.css);
  console.log(`  ${CSS_OUTPUT}  (from ${SCSS_ENTRY})`);
}

if (process.argv.includes('--watch')) {
  buildCss();
  const ctx = await context(jsOptions);
  await ctx.watch();
  // esbuild's watch only tracks the JS import graph — the sass compiler has
  // no equivalent JS-API watch mode, so re-run it on plain fs events instead.
  // Watches the whole directory (not just index.scss) so editing any of the
  // partials it @uses also triggers a rebuild.
  watch(SCSS_DIR, { recursive: true, persistent: true }, () => {
    try {
      buildCss();
    } catch (err) {
      console.error('sass: build failed:', err.message);
    }
  });
  console.log('esbuild + sass: watching for changes...');
} else {
  buildCss();
  await build(jsOptions);
}
