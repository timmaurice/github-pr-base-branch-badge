import { I18N_DEFAULT_LANG } from '../shared/i18n.js';

// Cache for processed PRs to avoid duplicate fetches
export const processedPRs = new Set();
export const branchCache = new Map();
// Branch names actually seen in badges this session, even ones without a
// configured color — lets the filter dropdown offer them too.
export const discoveredBranches = new Set();

// Default colors
export const DEFAULT_COLORS = {
  qas: '#3b82f6',
  int: '#f97316',
  main: '#10b981',
  preprod: '#ef4444',
  default: '#6b7280'
};

export let branchColors = { ...DEFAULT_COLORS };
export function setBranchColors(colors) {
  branchColors = colors;
}

// Optional PAT for the GitHub REST API — required for private repos, since
// api.github.com is a different origin and doesn't receive github.com's
// session cookies; also raises the rate limit from 60/h to 5000/h.
export let githubToken = '';
export function setGithubToken(token) {
  githubToken = token;
}

// UI language for the filter button/popover/badge tooltips, set from the
// popup's language selector (defaults to English).
export let uiLanguage = I18N_DEFAULT_LANG;
export function setUiLanguage(lang) {
  uiLanguage = lang;
}

// GitHub's pull-request octicon — fill uses currentColor so it always
// matches the badge's own text color.
export const PULL_REQUEST_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="flex-shrink:0;"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"></path></svg>';

// Persist discovered (uncolored) branch names across page loads — checkbox
// clicks trigger a full navigation, which would otherwise reset the
// in-memory Set and make branches "disappear" from the dropdown once
// they're no longer visible in the (now filtered) PR list.
export function loadDiscoveredBranches() {
  chrome.storage.local.get('discoveredBranches', (result) => {
    (result.discoveredBranches || []).forEach((b) => discoveredBranches.add(b));
  });
}

export function rememberDiscoveredBranch(branch) {
  if (discoveredBranches.has(branch)) return;
  discoveredBranches.add(branch);
  chrome.storage.local.set({ discoveredBranches: Array.from(discoveredBranches) });
}
