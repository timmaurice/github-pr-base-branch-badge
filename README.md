# GitHub PR Base Branch Badge Extension

A Chrome extension that shows the base (target) branch of pull requests in GitHub's PR list view as a colored badge, and lets you filter by one or more base branches.

## Features

✅ **Base Branch Badge** - Shows the base branch as a colored badge (PR icon + name) next to each PR
✅ **Click-to-Filter** - Clicking a badge instantly filters the list by exactly that base branch (open/closed filter state is preserved)
✅ **Multi-Select Dropdown** - "Base Branch ▾" before the Author filter, mirroring GitHub's own "Filter by author": a checkbox list of all known branches, several selectable at once, shows the number of active filters as a badge on the button
✅ **Popup Settings** - Customize colors per branch, add/rename/remove branches
✅ **Multilingual** - Language selector (English/German) in the popup, defaults to English; applies immediately to the popup and all open GitHub tabs
✅ **Persistent Caching** - Base branch (24h TTL) and once-seen branch names are cached in `chrome.storage.local`
✅ **Dark Mode Support** - Automatically adapts to the OS color scheme
✅ **Turbo-/Infinite-Scroll-Proof** - Works even with dynamically loaded-in PRs and when switching between the Issues/Pulls tabs, without a full page reload
✅ **Automatic Retry** - Transient errors (GitHub's secondary rate limit, network errors) are automatically retried on the next scan (e.g. scrolling) instead of leaving the row without a badge permanently

## Installation (Unpacked Mode)

For normal use, the pre-built release ZIP is all you need — **no Node/npm required**:

1. Download the latest release ZIP from the [Releases page](../../releases) (e.g. `github-pr-base-branch-badge-v1.0.0.zip`) and extract it
2. Open `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extracted folder
5. Navigate to a GitHub PR list (e.g. `github.com/<org>/<repo>/pulls`)

Every release ZIP already contains everything built (`manifest.json`, `popup.html`, `dist/`, `locales/`, icons) — identical to what `npm run package` produces locally (see below).

## Development

Only needed if you're working on the code itself — not for plain use of the extension:

1. `npm install` (once)
2. `npm run build` — compiles `src/**` into `dist/`, the directory `manifest.json`/`popup.html` reference (doesn't exist before the first build, isn't part of the repo)
3. Open `chrome://extensions/`, enable "Developer mode", "Load unpacked" → select this folder (not `dist/`) — `manifest.json` lives at the root and references `dist/*` internally

Other scripts:

- `npm run watch` — rebuilds automatically on every change under `src/`
- `npm run lint` / `npm run format` / `npm test` — ESLint, Prettier, Node's built-in test runner (`node --test`)
- `npm run package` — builds fresh and produces the release ZIP under `release/` (exactly what the `Release` workflow publishes automatically on a version tag)
- After changes under `src/content/` or `src/styles/`: rebuild, reload the extension in `chrome://extensions/`, then reload the GitHub tab
- After changes to `src/popup.js`: rebuild, just reopen the popup (no extension reload needed)

### Creating a release

1. Bump `manifest.json`'s `"version"`, commit
2. Push a `vX.Y.Z` tag (matching the new version) — `.github/workflows/release.yml` builds, tests, packages, and publishes the ZIP as a GitHub Release automatically

## Usage

1. A colored badge with a PR icon and branch name appears next to every PR
2. **Clicking a badge** filters the list by exactly that base branch
3. **"Base Branch ▾"** opens a dropdown with checkboxes for all known branches — several can be checked at once, the selection applies immediately; the number on the button shows the count of active filters
4. **Clicking the extension icon** opens the settings popup: change colors, add/rename/remove branches, set/test a token, switch language (EN/DE, applies immediately), reset discovered branches, save

## Architecture

```
manifest.json          Manifest v3 config — references dist/content.js, dist/background.js, dist/styles.css
popup.html             Settings popup markup — references dist/popup.js
src/content/           Content script source (ES modules) — index.js is the entry point; badge.js, filterDropdown.js,
                       query.js, state.js, storageCache.js, settings.js, utils.js each a module per concern
src/background.js      Service worker source — manages the persistent 24h cache for base-branch lookups and loads
                       locales/*.json (the content script isn't allowed to fetch that itself, see below)
src/popup.js           Popup logic source (manage branch colors, token, language)
src/shared/i18n.js     Requests a locale dict from background.js via chrome.runtime.sendMessage, caches it in memory,
                       and interpolates {placeholder} tokens; compiled into both bundles (content/popup)
src/styles/            SCSS sources (index.scss + partials), compiled into dist/styles.css
locales/*.json         EN/DE language files (one JSON per language) — new language: add a file with the same keys,
                       register it in src/background.js's LOCALE_FILES, add an option in popup.html
icon*.png/svg          Extension icon (icon.svg is the vector source for the PNGs, never loaded by Chrome itself)
dist/                  Generated by `npm run build` (esbuild + sass) — not part of the repo, don't hand-edit
```

### How the base branch is resolved

`content.js` calls `GET https://api.github.com/repos/{owner}/{repo}/pulls/{number}` for every newly seen PR and reads `base.ref` directly from the JSON response — no more HTML scraping. The result is then cached in two tiers:

1. In-memory (`branchCache`, per page load)
2. Persistent via `background.js` in `chrome.storage.local` (24h TTL)

**Important:** `api.github.com` is a different origin than `github.com` and therefore does **not** automatically receive the logged-in browser's session cookies. For private repos (and for a higher rate limit), a GitHub Personal Access Token must be set in the popup — a fine-grained token with "Pull requests: Read-only" permission is enough. Without a token, the extension only works for public repos and is limited to 60 requests/hour (with a token: 5000/hour).

`content.js` additionally remembers every branch name it has ever seen persistently in `chrome.storage.local` (`discoveredBranches`), so that branches without a configured color also show up in the filter dropdown — even after they've disappeared from the current (filtered) view. This set only grows; "Reset discovered branches" in the popup clears it again (branches then reappear only once their PRs are rescanned).

Failed PR lookups are handled by error type: GitHub's secondary rate limit and network errors are treated as transient — the affected row is removed from `processedPRs` and automatically retried on the next `setupPRBadges()` pass (e.g. triggered by scrolling). Permanent errors (404 without/with a wrong token, primary rate limit), on the other hand, are still just logged as before, since retrying without user action (setting a token, waiting) wouldn't change anything.

### Branch colors

`popup.js` manages a color map (`branchColors`) in `chrome.storage.local`. Branch names are freely chosen (rename/add/remove in the popup) — `content.js` looks up the color generically by branch name and falls back to the "default" color if no entry exists. After saving, the popup sends a `reloadBadges` signal to all open GitHub tabs, which removes existing badges and redraws them with the new colors (from the in-memory cache, without a new network request).

### Multi-selection in the filter

GitHub treats repeated `base:` qualifiers in search as OR, not AND — `base:master base:beta` matches PRs with base `master` **or** `beta`. The query helpers in `src/content/query.js` (`getSelectedBaseBranches`, `buildQueryForBaseBranches`, `navigateToQuery`) rely on exactly this behavior; clicking a badge, by contrast, deliberately sets just a single branch (replacing the current selection) — the dropdown is the way to select multiple.

### Navigation between Issues and Pulls

GitHub uses Turbo (Hotwire) for navigation between `/issues` and `/pulls` — the URL changes via the History API without a real page reload. For the badges/dropdown to still appear reliably:

- The manifest matches `https://github.com/*` broadly instead of just `*/pulls*`/`*/issues*` — PR detail pages (`/pull/<n>`, singular) are a distinct pattern, and whoever lands there first (or navigates list → detail → list via Turbo) must not be left without the injected script. `content.js` itself decides, via `isPRListPage()`, where anything actually happens.
- `content.js` reacts to the `turbo:load` event and re-attaches the `MutationObserver` to the current `document.body` on every navigation — GitHub sometimes replaces this element wholesale on certain navigations, which would otherwise disconnect an old observer.
- Changes to the filter selection (checkbox, badge click), on the other hand, trigger a real page reload (confirmed by observation), not just a Turbo soft navigation.

## Troubleshooting

**Badge not showing up?**

- Reload the page (F5)
- Check the extension in `chrome://extensions/` for errors
- Check the browser console (F12) for `Base Branch Badge:` warnings — a `404` on private repos without a token means: token missing; a `403` means: rate limit reached, add a token (or a different token with a higher limit)

**404 despite a set token, on an organization repo?**

- Fine-grained tokens with "All repositories" only apply to repos personally owned — repos belonging to an organization (e.g. `hafele-group-it`) are excluded from that until the organization has explicitly allowed/approved fine-grained token access (org settings → Personal access tokens)
- Faster workaround: create a **classic token** with the `repo` scope (`github.com/settings/tokens` → "Generate new token (classic)") — doesn't need org approval, unless the organization enforces SSO (then authorize the token once via "Enable SSO" for the org)

**Popup doesn't open?**

- Pin the extension icon in the toolbar (puzzle icon 🧩 → Pin)
- Alternatively: `chrome://extensions/` → Details → "Extension options" no longer exists, settings run exclusively through the popup

**A branch is missing from the filter dropdown?**

- It must have been visible as a badge at least once (or be configured in the popup's color settings) for it to land in `discoveredBranches`

## Known Limitations

- Every newly seen PR causes an extra API request to determine the base branch (only once per PR thanks to caching)
- Without a token set: public repos only, 60 API requests/hour (shared across all extensions/tools that access the GitHub API unauthenticated)
- Branch name matching is case-sensitive and must exactly match GitHub's name
- `discoveredBranches` only grows (no automatic cleanup) — deleted/renamed branches remain visible in the filter dropdown until "Reset discovered branches" is manually triggered in the popup
- Language selection (EN/DE) only covers text rendered by the extension itself (badges, filter dropdown, popup) — not GitHub's own interface
- `github.com` only, no GitHub Enterprise Server (own domain) — `manifest.json` would need to be extended with the corresponding domain for that
