import { processedPRs, branchCache, discoveredBranches, loadDiscoveredBranches } from './state.js';
import { setupPRBadges } from './badge.js';
import { refreshFilterUI } from './filterDropdown.js';
import { loadColorSettings, loadGithubToken, loadUiLanguage } from './settings.js';

// Listen for reload signal from popup
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'reloadBadges') {
    // Existing badges already have the old color baked in as inline styles,
    // so they must be removed before re-adding — setupPRBadges() skips rows
    // that already have a badge. The filter button/popover is rebuilt too,
    // since its label and options are baked in at creation time (language
    // or newly-added branch colors wouldn't otherwise show up until the
    // next full page load).
    document.querySelectorAll('.base-branch-badge').forEach((el) => el.remove());
    document.querySelectorAll('.base-branch-filter-btn').forEach((el) => el.remove());
    processedPRs.clear();
    loadUiLanguage(() => {
      loadGithubToken(() => {
        loadColorSettings(() => {
          setupPRBadges();
          refreshFilterUI();
        });
      });
    });
  }

  if (message.action === 'clearDiscoveredBranches') {
    discoveredBranches.clear();
    document.querySelectorAll('.base-branch-filter-btn').forEach((el) => el.remove());
    refreshFilterUI();
  }
});

// Initial setup
// loadGithubToken() must finish before any fetch fires, otherwise the first
// PR lookups go out unauthenticated (hitting the 60/h limit instead of the
// token's 5000/h) — chrome.storage.local.get is async and isn't guaranteed
// to beat a fixed setTimeout.
loadDiscoveredBranches();
loadUiLanguage(() => {
  loadGithubToken(() => {
    loadColorSettings(() => {
      setTimeout(() => {
        setupPRBadges();
        refreshFilterUI();
      }, 100);
    });
  });
});

// Debounced re-setup for infinite scroll (avoid too many calls)
let debounceTimer;
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    setupPRBadges();
    refreshFilterUI();
  }, 300);
});

// GitHub replaces <body> wholesale on some Turbo navigations, which silently
// detaches an observer watching the old element — always re-observe the
// CURRENT document.body rather than assuming the original reference still
// receives mutations.
function attachBodyObserver() {
  observer.disconnect();
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

attachBodyObserver();

function handleNavigation({ clearBranchCache }) {
  // Old badge/chip/dropdown elements belonged to the DOM Turbo just swapped
  // out (or their href/state reflects the pre-navigation query) — drop them
  // so they get rebuilt fresh instead of skipped as "already present".
  document.querySelectorAll('.base-branch-badge').forEach((el) => el.remove());
  processedPRs.clear();
  if (clearBranchCache) branchCache.clear();
  attachBodyObserver();
  setTimeout(() => {
    setupPRBadges();
    refreshFilterUI();
  }, 150);
}

// GitHub navigates between /issues and /pulls via Turbo (Hotwire): the URL
// changes through the History API without a real page load, so the content
// script is never re-injected and popstate never fires. Turbo's own
// "turbo:load" event (dispatched on every visit, including soft navigations)
// is what reliably tells us new content has been rendered. "pjax:end" is
// kept as a harmless fallback for any pages still on GitHub's older pjax.
document.addEventListener('turbo:load', () => handleNavigation({ clearBranchCache: false }));
document.addEventListener('pjax:end', () => handleNavigation({ clearBranchCache: false }));

// Real browser back/forward navigation.
window.addEventListener('popstate', () => handleNavigation({ clearBranchCache: true }));
