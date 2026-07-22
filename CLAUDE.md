# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome Manifest V3 extension that shows the base (target) branch of each PR in GitHub's PR list view as a colored badge, and adds a multi-select branch filter. Source lives in `src/` as real ES modules plus one SCSS file; esbuild and `sass` compile it all into `dist/` (`content.js`/`background.js`/`popup.js`/`styles.css`), which is what `manifest.json`/`popup.html` actually reference. `dist/` is gitignored, pure build output — it does not exist until `npm run build` has been run at least once.

## Development workflow

`npm install` once, then:

1. `npm run build` (one-shot) or `npm run watch` (rebuilds on save) — compiles `src/**` into `dist/content.js`/`dist/background.js`/`dist/popup.js`/`dist/styles.css`. **Edit files under `src/`, never anything under `dist/` directly** — it's regenerated on every build and gitignored, so nothing there survives a clean clone anyway.
2. Open `chrome://extensions/`, enable "Developer mode".
3. "Load unpacked" → select this folder (repo root, not `dist/` — `manifest.json`/`popup.html` live at the root and reference `dist/*` internally) the first time, or click the reload icon on the extension card after a rebuild.
4. Navigate to a GitHub PR list, e.g. `github.com/<org>/<repo>/pulls`.
5. Check `chrome://extensions/` for load errors, and the page's DevTools console (F12) for `Base Branch Badge:`-prefixed warnings (rate limits, 404s, SSO issues are all logged there — see README Troubleshooting section for what each one means).
6. After editing `src/popup.js`/`popup.html`, rebuild and just reopen the popup — no extension reload needed unless `src/content/**`/`src/background.js`/`manifest.json` changed.
7. After editing anything under `src/content/` or `src/styles/`, rebuild, then do a full reload of the extension AND the GitHub tab.

`npm run lint` (ESLint, flat config in `eslint.config.cjs`), `npm run format` / `format:check` (Prettier — also formats `src/styles/**/*.scss` natively), and `npm test` (Node's built-in test runner, `node --test`, zero extra dependencies — covers the pure logic in `src/content/query.js`, `src/content/utils.js`, `src/shared/i18n.js`) all cover `src/**` and the repo's own tooling files; `dist/` is excluded from both lint and format (it's build output, not hand-written) and CI (`.github/workflows/ci.yml`) runs all of the above plus a plain `npm run build` to prove `src/` still compiles.

## Architecture

- **`manifest.json`** — MV3 config. Content script matches all of `https://github.com/*` (not just `*/pulls*`/`*/issues*`) — PR detail pages are `/pull/<n>` (singular), a distinct pattern, and landing there first (or navigating list → detail → list via Turbo) must not leave the script uninjected. `content.js` itself gates what actually runs per page (see Turbo note below); running the script harmlessly on unrelated pages is the tradeoff. References `dist/content.js`, `dist/background.js`, `dist/styles.css` — build first or these won't exist.
- **`src/content/`** — bundled into `dist/content.js`. `index.js` is the entry point (message listener, initial load sequence, Turbo/MutationObserver wiring); `badge.js` fetches/renders PR badges; `filterDropdown.js` builds the branch-filter button/popover; `query.js` builds/parses the `base:` search query; `state.js` holds the shared mutable state (`branchColors`, `githubToken`, `uiLanguage`, caches) plus setters, since ES module bindings can only be reassigned by the module that declares them; `storageCache.js` messages `background.js` for the per-PR branch cache; `settings.js` loads persisted settings into `state.js`; `utils.js` has small stateless helpers (`isDarkMode`, `adjustColor`, etc). Content scripts registered via `manifest.json` can't be declared `type: "module"` (only dynamic `import()` works there) — bundling to a plain IIFE is what makes real `import`/`export` usable for this source at all.
- **`src/background.js`** — MV3 service worker (single file, no imports needed), bundled into `dist/background.js`. Mediates `chrome.storage.local` reads/writes for the 24h base-branch cache, and fetches `locales/*.json` on request (see i18n below) — both are things `content.js` can't or shouldn't do directly itself.
- **`src/popup.js`** (bundled into `dist/popup.js`) / **`popup.html`** — settings popup (branch → color map, GitHub token, UI language). No separate options page exists; all config is in the popup.
- **`src/shared/i18n.js`** — small loader used by both the content and popup bundles: requests a locale dict from `background.js` via `chrome.runtime.sendMessage`, caches it in memory, and does `{placeholder}` interpolation. Each bundle gets its own copy inlined by esbuild — it's not a shared runtime. See "UI language / i18n" below for why it doesn't fetch directly.
- **`src/styles/`** — compiled by `sass` into `dist/styles.css`. `index.scss` is the entry point (`@use`, not the deprecated `@import`, so each partial declares its own dependencies rather than relying on load order); one partial per component/concern, mirroring `src/content/*.js`: `_github-overrides.scss` (patches to GitHub's own layout, unrelated to our components), `_badge.scss`, `_filter-dropdown.scss`, plus `_variables.scss`/`_mixins.scss` for the small amount of shared Sass (`$github-accent-blue`, and a `@mixin` for the hover/focus-visible background-color rule shared by the filter dropdown's button/close/row controls). `&`-nesting is used only for pseudo-classes and BEM-style modifiers (`&--active`, `&--visible`) on each class's own block, not to mirror DOM depth — nesting selectors more than ~2-3 levels deep is a known Sass anti-pattern (bloated, hard-to-override selectors) and wasn't needed here. Per-instance dynamic values (per-branch badge color, JS-detected light/dark theme) are CSS custom properties set from JS, not Sass variables — Sass compiles once at build time and has no way to know a runtime value.
- **`locales/en.json`**, **`locales/de.json`** — one flat key→string JSON file per language. Add a language by adding a file here (same keys), registering it in `src/background.js`'s `LOCALE_FILES` map, and adding an `<option>` in `popup.html`.
- **`scripts/build.mjs`** — the esbuild + sass driver (object-form `entryPoints` so each JS entry maps to a specific output basename in `dist/`; a plain recursive `fs.watch` on `src/styles/` drives CSS rebuilds in `--watch` mode — since sass's JS API has no built-in watch mode, and watching only `index.scss` itself would miss edits to the partials it `@use`s). Run via `npm run build`/`npm run watch`, not meant to be imported.
- **`scripts/package.mjs`** (`npm run package`) — rebuilds, then stages exactly what a "Load unpacked" install needs (`manifest.json`, `popup.html`, `dist/`, `locales/`, the three PNG icons — no `src/`, no tooling configs, no `icon.svg`) into a zip under the gitignored `release/`. `.github/workflows/release.yml` runs this on every `v*` tag push (after verifying the tag matches `manifest.json`'s `version`) and publishes the zip as a GitHub Release — the point being that end users installing the extension never need Node/npm at all, only contributors editing `src/` do.
- **`icon16.png`/`icon48.png`/`icon128.png`/`icon.svg`** — extension icons referenced by `manifest.json`; `icon.svg` is the vector source for the three PNGs and is never itself loaded by Chrome, which is why `scripts/package.mjs` leaves it out of the release zip.

### How the base branch is resolved

`content.js` calls `GET https://api.github.com/repos/{owner}/{repo}/pulls/{number}` and reads `base.ref` — no HTML scraping. Two-tier cache: in-memory `branchCache` (per page load) backed by `background.js`'s `chrome.storage.local` cache (24h TTL, keyed `branch_<prUrl>`).

`api.github.com` is a different origin than `github.com` and does **not** get the logged-in session cookies. Private repos (and a higher rate limit — 60/h unauthenticated vs 5000/h) require a GitHub PAT set in the popup. A fine-grained token needs "Pull requests: Read-only"; org-owned repos may need a classic token with `repo` scope instead if the org hasn't approved fine-grained tokens.

PR row fetches are deliberately sequential (`await` in a `for` loop in `setupPRBadges`, `src/content/badge.js`), not parallelized — parallel requests reliably tripped GitHub's secondary/abuse rate limit even with unused primary quota remaining. Don't change this to `Promise.all` without re-testing against real rate limits.

Every branch name ever seen in a badge is persisted to `chrome.storage.local` as `discoveredBranches`, independent of the color map, so the filter dropdown can offer branches that have no configured color and even ones that have scrolled out of the current (filtered) view. This set only grows — nothing prunes it.

Failed PR lookups are handled by error type: GitHub's secondary rate limit and network errors are treated as transient — the affected row is removed from `processedPRs` and automatically retried on the next `setupPRBadges()` pass (e.g. triggered by scrolling). Permanent errors (404 without/with a wrong token, primary rate limit), on the other hand, are still just logged as before, since retrying without user action (setting a token, waiting) wouldn't change anything.

### Branch colors

`popup.js` manages a `branchColors` map (`chrome.storage.local`), keyed by arbitrary branch name (rename/add/remove supported) plus a `default` fallback color. `content.js` looks up colors generically by name and falls back to `default`. Saving in the popup broadcasts a `reloadBadges` message to all open `github.com` tabs; `content.js` removes existing badge DOM (colors are baked in per-element as CSS custom properties set once at creation, so elements must be rebuilt, not just restyled) and redraws from the in-memory `branchCache` — no network re-fetch.

### Multi-branch filtering

GitHub's search treats repeated `base:` qualifiers as OR: `base:master base:beta` matches either. The query helpers in `src/content/query.js` (`getSelectedBaseBranches`, `buildQueryForBaseBranches`, `navigateToQuery`) rely on this — no special grouping syntax needed. Clicking a badge is intentionally different from the dropdown: it replaces the whole selection with exactly that one branch; the toolbar dropdown is the only path to selecting multiple branches at once.

### UI language / i18n

Popup has an EN/DE language selector (`uiLanguage` in `chrome.storage.local`, default `en`); switching it re-renders the popup immediately and broadcasts `reloadBadges` to open `github.com` tabs so `content.js` rebuilds the filter button/popover in the new language.

`content.js` cannot `fetch(chrome.runtime.getURL('locales/en.json'))` directly — content scripts inherit the host page's CSP for `fetch()`/`XHR`, and GitHub's CSP blocks the request to the `chrome-extension://` URL (this was tried and failed with a console error before landing on the current approach). `background.js` (a service worker, not subject to page CSP) fetches the JSON instead; the content and popup bundles request it via `chrome.runtime.sendMessage({ action: 'getLocaleDict', lang })` through `src/shared/i18n.js`, same shape as the existing branch-cache messaging. Don't "simplify" this back to a direct fetch in `content.js`.

### Turbo navigation (issues ⟷ pulls)

GitHub navigates between `/issues` and `/pulls` via Turbo (Hotwire) — a History API URL change with no real page load, so the content script isn't re-injected and `popstate` doesn't fire. `content.js` listens for `turbo:load` (fires on every Turbo visit, including soft nav) to rebuild badges/dropdown, and re-attaches its `MutationObserver` to `document.body` on every navigation since GitHub sometimes replaces `<body>` wholesale, silently detaching an observer bound to the old element. `pjax:end` is kept as a harmless fallback for any pages still on old pjax.

Filter changes (checkbox toggle, badge click) trigger a real page reload via `window.location.search`, not a Turbo soft nav — confirmed by observation, not just a design choice.

## Known limitations (see README for full list)

- One API request per newly-seen PR (cached after first time per PR/24h).
- Unauthenticated: public repos only, 60 req/h shared browser-wide.
- Branch name matching is case-sensitive, exact match to GitHub's name.
- `discoveredBranches` never shrinks.
- `github.com` only — no GitHub Enterprise Server support (would need a `manifest.json` host addition).
