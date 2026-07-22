# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome Manifest V3 extension that shows the base (target) branch of each PR in GitHub's PR list view as a colored badge, and adds a multi-select branch filter. No build step, no package manager, no bundler, no tests — plain JS/HTML/CSS loaded directly by Chrome.

## Development workflow

There is no build/lint/test command. To develop and verify changes:

1. Open `chrome://extensions/`, enable "Developer mode".
2. "Load unpacked" → select this folder (first time), or click the reload icon on the extension card (after edits).
3. Navigate to a GitHub PR list, e.g. `github.com/<org>/<repo>/pulls`.
4. Check `chrome://extensions/` for load errors, and the page's DevTools console (F12) for `Base Branch Badge:`-prefixed warnings (rate limits, 404s, SSO issues are all logged there — see README Troubleshooting section for what each one means).
5. After editing `popup.js`/`popup.html`, just reopen the popup — no reload needed unless `content.js`/`background.js`/`manifest.json` changed.
6. After editing `content.js`, do a full reload of the extension AND the GitHub tab.

## Architecture

- **`manifest.json`** — MV3 config. Content script matches all of `https://github.com/*` (not just `*/pulls*`/`*/issues*`) — PR detail pages are `/pull/<n>` (singular), a distinct pattern, and landing there first (or navigating list → detail → list via Turbo) must not leave the script uninjected. `content.js` itself gates what actually runs per page (see Turbo note below); running the script harmlessly on unrelated pages is the tradeoff.
- **`content.js`** — injected into GitHub PR/issue pages. Finds PR rows, resolves each PR's base branch, injects badges and the branch-filter dropdown. This is where almost all logic lives.
- **`background.js`** — MV3 service worker. Mediates `chrome.storage.local` reads/writes for the 24h base-branch cache, and fetches `locales/*.json` on request (see i18n below) — both are things `content.js` can't or shouldn't do directly itself.
- **`popup.js`** / **`popup.html`** — settings popup (branch → color map, GitHub token, UI language). No separate options page exists; all config is in the popup.
- **`i18n.js`** — small loader used by both `content.js` and `popup.js`: requests a locale dict from `background.js` via `chrome.runtime.sendMessage`, caches it in memory, and does `{placeholder}` interpolation. See "UI language / i18n" below for why it doesn't fetch directly.
- **`locales/en.json`**, **`locales/de.json`** — one flat key→string JSON file per language. Add a language by adding a file here (same keys), registering it in `background.js`'s `LOCALE_FILES` map, and adding an `<option>` in `popup.html`.

### How the base branch is resolved

`content.js` calls `GET https://api.github.com/repos/{owner}/{repo}/pulls/{number}` and reads `base.ref` — no HTML scraping. Two-tier cache: in-memory `branchCache` (per page load) backed by `background.js`'s `chrome.storage.local` cache (24h TTL, keyed `branch_<prUrl>`).

`api.github.com` is a different origin than `github.com` and does **not** get the logged-in session cookies. Private repos (and a higher rate limit — 60/h unauthenticated vs 5000/h) require a GitHub PAT set in the popup. A fine-grained token needs "Pull requests: Read-only"; org-owned repos may need a classic token with `repo` scope instead if the org hasn't approved fine-grained tokens.

PR row fetches are deliberately sequential (`await` in a `for` loop in `setupPRBadges`), not parallelized — parallel requests reliably tripped GitHub's secondary/abuse rate limit even with unused primary quota remaining. Don't change this to `Promise.all` without re-testing against real rate limits.

Every branch name ever seen in a badge is persisted to `chrome.storage.local` as `discoveredBranches`, independent of the color map, so the filter dropdown can offer branches that have no configured color and even ones that have scrolled out of the current (filtered) view. This set only grows — nothing prunes it.

### Branch colors

`popup.js` manages a `branchColors` map (`chrome.storage.local`), keyed by arbitrary branch name (rename/add/remove supported) plus a `default` fallback color. `content.js` looks up colors generically by name and falls back to `default`. Saving in the popup broadcasts a `reloadBadges` message to all open `github.com` tabs; `content.js` removes existing badge DOM (colors are baked in as inline styles, so elements must be rebuilt, not just restyled) and redraws from the in-memory `branchCache` — no network re-fetch.

### Multi-branch filtering

GitHub's search treats repeated `base:` qualifiers as OR: `base:master base:beta` matches either. The query helpers in `content.js` (`getSelectedBaseBranches`, `buildQueryForBaseBranches`, `navigateToQuery`) rely on this — no special grouping syntax needed. Clicking a badge is intentionally different from the dropdown: it replaces the whole selection with exactly that one branch; the toolbar dropdown is the only path to selecting multiple branches at once.

### UI language / i18n

Popup has an EN/DE language selector (`uiLanguage` in `chrome.storage.local`, default `en`); switching it re-renders the popup immediately and broadcasts `reloadBadges` to open `github.com` tabs so `content.js` rebuilds the filter button/popover in the new language.

`content.js` cannot `fetch(chrome.runtime.getURL('locales/en.json'))` directly — content scripts inherit the host page's CSP for `fetch()`/`XHR`, and GitHub's CSP blocks the request to the `chrome-extension://` URL (this was tried and failed with a console error before landing on the current approach). `background.js` (a service worker, not subject to page CSP) fetches the JSON instead; `content.js`/`popup.js` request it via `chrome.runtime.sendMessage({ action: 'getLocaleDict', lang })` through `i18n.js`, same shape as the existing branch-cache messaging. Don't "simplify" this back to a direct fetch in `content.js`.

### Turbo navigation (issues ⟷ pulls)

GitHub navigates between `/issues` and `/pulls` via Turbo (Hotwire) — a History API URL change with no real page load, so the content script isn't re-injected and `popstate` doesn't fire. `content.js` listens for `turbo:load` (fires on every Turbo visit, including soft nav) to rebuild badges/dropdown, and re-attaches its `MutationObserver` to `document.body` on every navigation since GitHub sometimes replaces `<body>` wholesale, silently detaching an observer bound to the old element. `pjax:end` is kept as a harmless fallback for any pages still on old pjax.

Filter changes (checkbox toggle, badge click) trigger a real page reload via `window.location.search`, not a Turbo soft nav — confirmed by observation, not just a design choice.

## Known limitations (see README for full list)

- One API request per newly-seen PR (cached after first time per PR/24h).
- Unauthenticated: public repos only, 60 req/h shared browser-wide.
- Branch name matching is case-sensitive, exact match to GitHub's name.
- `discoveredBranches` never shrinks.
- `github.com` only — no GitHub Enterprise Server support (would need a `manifest.json` host addition).
