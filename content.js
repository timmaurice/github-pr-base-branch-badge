// Cache for processed PRs to avoid duplicate fetches
const processedPRs = new Set();
const branchCache = new Map();
// Branch names actually seen in badges this session, even ones without a
// configured color — lets the filter dropdown offer them too.
const discoveredBranches = new Set();

// Default colors
const DEFAULT_COLORS = {
  qas: '#3b82f6',
  int: '#f97316',
  main: '#10b981',
  preprod: '#ef4444',
  default: '#6b7280'
};

let branchColors = { ...DEFAULT_COLORS };
// Optional PAT for the GitHub REST API — required for private repos, since
// api.github.com is a different origin and doesn't receive github.com's
// session cookies; also raises the rate limit from 60/h to 5000/h.
let githubToken = '';

// GitHub's pull-request octicon — fill uses currentColor so it always
// matches the badge's own text color.
const PULL_REQUEST_ICON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="flex-shrink:0;"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"></path></svg>';

// Send message to background script for storage operations (no direct chrome.storage access)
function getCachedBranch(prUrl) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { action: 'getCachedBranch', prUrl },
        (response) => {
          if (response && response.success) {
            resolve(response.branch);
          } else {
            resolve(null);
          }
        }
      );
    } catch (err) {
      resolve(null); // Fallback if messaging fails
    }
  });
}

function setCachedBranch(prUrl, branch) {
  try {
    chrome.runtime.sendMessage(
      { action: 'setCachedBranch', prUrl, branch },
      (response) => {
        if (response && response.success) {
          // Silent - don't log every storage write
        }
      }
    );
  } catch (err) {
    // Fallback if messaging fails - just continue
  }
}

function isPRListPage() {
  return /\/pulls\/?$/.test(window.location.pathname);
}

// Persist discovered (uncolored) branch names across page loads — checkbox
// clicks trigger a full navigation, which would otherwise reset the
// in-memory Set and make branches "disappear" from the dropdown once
// they're no longer visible in the (now filtered) PR list.
function loadDiscoveredBranches() {
  chrome.storage.local.get('discoveredBranches', (result) => {
    (result.discoveredBranches || []).forEach(b => discoveredBranches.add(b));
  });
}

function rememberDiscoveredBranch(branch) {
  if (discoveredBranches.has(branch)) return;
  discoveredBranches.add(branch);
  chrome.storage.local.set({ discoveredBranches: Array.from(discoveredBranches) });
}

// --- Base branch query helpers -------------------------------------------
// GitHub treats repeated `base:` qualifiers as OR (not AND), so selecting
// several branches is just multiple "base:x" tokens — e.g. "base:master
// base:beta" already matches PRs targeting either branch.

function getSelectedBaseBranches() {
  const params = new URLSearchParams(window.location.search);
  const query = params.get('q') || '';
  const matches = query.match(/base:([a-zA-Z0-9\-_.\/]+)/g) || [];
  return matches.map(m => m.slice('base:'.length));
}

function removeBaseFilters(query) {
  return query
    .replace(/base:[a-zA-Z0-9\-_.\/]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildQueryForBaseBranches(branches, originalQuery) {
  const params = new URLSearchParams(window.location.search);
  const original = originalQuery ?? (params.get('q') || '');
  const isClosed = /\bis:closed\b/.test(original);

  const query = removeBaseFilters(original);

  if (branches.length === 0) {
    return query;
  }

  // GitHub treats repeated `base:` qualifiers as OR, so no grouping syntax
  // is needed — "base:master base:beta" already matches either branch.
  const group = branches.map(b => `base:${b}`).join(' ');

  if (query) {
    return `${query} ${group}`;
  }
  return `is:pr ${group} ${isClosed ? 'is:closed' : 'is:open'}`;
}

function navigateToQuery(query) {
  const params = new URLSearchParams(window.location.search);
  params.set('q', query);
  window.location.search = params.toString();
}

function isDarkMode() {
  return document.documentElement.getAttribute('data-color-mode') === 'dark' ||
    document.body.classList.contains('dark') ||
    window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// Fetch PR details and add base branch badge. Sequential on purpose — firing
// one request per row in parallel (a PR list page easily has 25+) reliably
// tripped GitHub's secondary/abuse rate limit even with a fresh token that
// had plenty of primary quota left.
async function setupPRBadges() {
  const prRows = document.querySelectorAll('.Box-row');

  for (const prRow of prRows) {
    // Skip if already has badge
    if (prRow.querySelector('.base-branch-badge')) {
      continue;
    }

    const prLink = prRow.querySelector('a[href*="/pull/"]');
    if (!prLink) continue;

    const prUrl = prLink.getAttribute('href');

    // Skip if already processed
    if (processedPRs.has(prUrl)) {
      continue;
    }

    processedPRs.add(prUrl);

    // Check cache first
    if (branchCache.has(prUrl)) {
      const baseBranch = branchCache.get(prUrl);
      addBaseBranchBadge(prRow, prLink, baseBranch);
      continue;
    }

    // Fetch the PR from the API before moving to the next row
    await fetchAndExtractBaseBranch(prUrl, prRow, prLink);
  }
}

function parsePRUrl(prUrl) {
  const match = prUrl.match(/^\/?([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  const [, owner, repo, number] = match;
  return { owner, repo, number };
}

async function fetchAndExtractBaseBranch(prUrl, prRow, prLink) {
  try {
    // Check storage cache first
    const cachedBranch = await getCachedBranch(prUrl);
    if (cachedBranch) {
      addBaseBranchBadge(prRow, prLink, cachedBranch);
      return;
    }

    const parsed = parsePRUrl(prUrl);
    if (!parsed) {
      console.warn(`Base Branch Badge: could not parse PR URL: ${prUrl}`);
      return;
    }
    const { owner, repo, number } = parsed;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`;

    const headers = { Accept: 'application/vnd.github+json' };
    if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

    const response = await fetch(apiUrl, { headers });

    if (!response.ok) {
      const prLabel = `${owner}/${repo}#${number}`;
      const ssoHeader = response.headers.get('x-github-sso');
      let apiMessage = '';
      try {
        const errorBody = await response.clone().json();
        apiMessage = errorBody.message || '';
      } catch (e) {
        // Body wasn't JSON — proceed without it.
      }

      if (ssoHeader) {
        const ssoUrlMatch = ssoHeader.match(/url=(\S+)/);
        const ssoUrl = ssoUrlMatch ? ssoUrlMatch[1] : `https://github.com/orgs/${owner}/sso`;
        console.warn(`Base Branch Badge: the token isn't authorized for SSO on "${owner}" (${prLabel}) — open ${ssoUrl}, click "Authorize", then reload the page.`);
      } else if (response.status === 404 && !githubToken) {
        console.warn(`Base Branch Badge: 404 for ${prLabel} — private repos need a GitHub token in the extension popup settings.`);
      } else if (response.status === 404 && githubToken) {
        console.warn(`Base Branch Badge: 404 for ${prLabel} despite a token being set — for organization-owned repos, a fine-grained token needs the org's approval (Settings → Personal access tokens, on the org) or use a classic token with the "repo" scope instead.`);
      } else if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        const resetHeader = response.headers.get('x-ratelimit-reset');
        const resetTime = resetHeader ? new Date(Number(resetHeader) * 1000).toLocaleTimeString() : 'unknown';
        console.warn(`Base Branch Badge: primary API rate limit exhausted for ${prLabel} — resets at ${resetTime}. Add/replace the token in the extension popup settings for a higher limit.`);
      } else if (response.status === 403 && /secondary rate limit|abuse/i.test(apiMessage)) {
        console.warn(`Base Branch Badge: hit GitHub's secondary rate limit for ${prLabel} (too many requests too quickly) — this should clear up within a minute; just retry.`);
      } else if (response.status === 403) {
        console.warn(`Base Branch Badge: 403 for ${prLabel}${apiMessage ? ` — ${apiMessage}` : ''}`);
      } else {
        console.warn(`Base Branch Badge: API request failed (${response.status}) for ${prLabel}${apiMessage ? ` — ${apiMessage}` : ''}`);
      }
      return;
    }

    const data = await response.json();
    const baseBranch = data.base && data.base.ref;

    if (baseBranch) {
      // Cache in memory
      branchCache.set(prUrl, baseBranch);
      // Cache in storage (async, no await needed)
      setCachedBranch(prUrl, baseBranch);
      addBaseBranchBadge(prRow, prLink, baseBranch);
    } else {
      console.warn(`Base Branch Badge: API response missing base.ref for ${owner}/${repo}#${number}`);
    }
  } catch (error) {
    console.error('Base Branch Badge: error fetching PR from API', error);
  }
}

function addBaseBranchBadge(prRow, prLink, baseBranch) {
  // Double-check not already added
  if (prRow.querySelector('.base-branch-badge')) {
    return;
  }

  // Sanitize branch name
  baseBranch = baseBranch.trim().split(/\s+/)[0];

  if (!baseBranch || baseBranch.length < 2) {
    return;
  }

  rememberDiscoveredBranch(baseBranch);

  // Get color for this branch
  const bgColor = branchColors[baseBranch] || branchColors.default;

  // Create badge element
  const badge = document.createElement('a');
  badge.className = 'base-branch-badge';
  badge.innerHTML = `${PULL_REQUEST_ICON_SVG}<span>${baseBranch}</span>`;
  // Clicking a badge selects ONLY this branch (replacing any other
  // selection) — the toolbar dropdown is the tool for multi-select.
  badge.href = `?q=${encodeURIComponent(buildQueryForBaseBranches([baseBranch]))}`;
  badge.title = `Filter by target branch: ${baseBranch}`;

  // Apply color styling
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 8px;
    padding: 2px 8px;
    background-color: ${bgColor};
    border: 1px solid ${adjustColor(bgColor, -20)};
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
    color: white;
    text-decoration: none;
    transition: all 0.2s ease-in-out;
    cursor: pointer;
    white-space: nowrap;
    vertical-align: middle;
    line-height: 1.2;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  `;

  // Hover effect
  badge.addEventListener('mouseenter', () => {
    badge.style.backgroundColor = adjustColor(bgColor, 20);
    badge.style.transform = 'translateY(-1px)';
  });

  badge.addEventListener('mouseleave', () => {
    badge.style.backgroundColor = bgColor;
    badge.style.transform = 'translateY(0)';
  });

  // Insert badge right after the PR link
  prLink.parentNode.insertBefore(badge, prLink.nextSibling);
}

// Utility: adjust color brightness
function adjustColor(color, amount) {
  const c = parseInt(color.substring(1), 16);
  const r = Math.max(0, Math.min(255, (c >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((c >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (c & 0xff) + amount));
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Adds a "Base Branch ▾" dropdown before the Author button, offering a
// checkbox per known branch — mirrors GitHub's own "Filter by author"
// popover, but allows selecting several branches at once (OR-combined).
function ensureBaseBranchFilterButton() {
  if (!isPRListPage()) return;

  const authorButton = document.querySelector('#author-select-menu');
  if (!authorButton) return;

  const filterHeader = authorButton.parentElement;
  if (!filterHeader) return;

  if (filterHeader.querySelector('.base-branch-filter-btn')) return;

  const dark = isDarkMode();
  const colors = dark
    ? {
        bg: '#1c2128',
        border: '#30363d',
        divider: '#30363d',
        text: '#e6edf3',
        muted: '#7d8590',
        hover: 'rgba(177, 186, 196, 0.12)',
        inputBg: '#0d1117',
        inputBorder: '#30363d',
        focusRing: '#1f6feb'
      }
    : {
        bg: '#ffffff',
        border: '#d0d7de',
        divider: '#d8dee4',
        text: '#1f2328',
        muted: '#59636e',
        hover: 'rgba(208, 215, 222, 0.32)',
        inputBg: '#ffffff',
        inputBorder: '#d0d7de',
        focusRing: '#0969da'
      };

  const wrapper = document.createElement('div');
  wrapper.className = 'base-branch-filter-btn';
  wrapper.style.cssText = `
    position: relative;
    display: inline-flex;
    align-items: center;
    align-self: stretch;
    margin-right: 8px;
  `;

  const button = document.createElement('button');
  button.type = 'button';
  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    background: transparent;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    color: ${colors.text};
    cursor: pointer;
    align-self: center;
  `;
  button.addEventListener('mouseenter', () => { button.style.backgroundColor = colors.hover; });
  button.addEventListener('mouseleave', () => { button.style.backgroundColor = 'transparent'; });

  const buttonLabel = document.createElement('span');
  buttonLabel.textContent = 'Target Branch';

  const buttonCount = document.createElement('span');
  buttonCount.className = 'base-branch-filter-count';
  buttonCount.style.cssText = `
    display: none;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background-color: #0969da;
    color: #ffffff;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
  `;

  const buttonArrow = document.createElement('span');
  buttonArrow.textContent = '▾';

  button.appendChild(buttonLabel);
  button.appendChild(buttonCount);
  button.appendChild(buttonArrow);

  // Reflects the current selection right when the button is (re)created —
  // checkbox changes navigate to a new URL, so the button is rebuilt fresh
  // with the up-to-date count on the next load rather than updated in place.
  const selectedOnLoad = getSelectedBaseBranches();
  if (selectedOnLoad.length > 0) {
    buttonCount.textContent = String(selectedOnLoad.length);
    buttonCount.style.display = 'inline-flex';
    button.style.fontWeight = '600';
  }

  const popover = document.createElement('div');
  popover.className = 'base-branch-filter-popover';
  popover.style.cssText = `
    display: none;
    flex-direction: column;
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 6px;
    width: 300px;
    max-height: 380px;
    background: ${colors.bg};
    border: 1px solid ${colors.border};
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    z-index: 100;
    overflow: hidden;
  `;

  function closePopover() {
    popover.style.display = 'none';
  }

  function renderPopoverContent() {
    popover.innerHTML = '';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      flex-shrink: 0;
    `;

    const title = document.createElement('span');
    title.textContent = 'Filter by target branch';
    title.style.cssText = `font-weight: 600; font-size: 14px; color: ${colors.text};`;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Schließen');
    closeBtn.style.cssText = `
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      border-radius: 6px;
      color: ${colors.muted};
      font-size: 13px;
      cursor: pointer;
    `;
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.backgroundColor = colors.hover; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.backgroundColor = 'transparent'; });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePopover();
    });

    headerRow.appendChild(title);
    headerRow.appendChild(closeBtn);
    popover.appendChild(headerRow);

    const divider = document.createElement('div');
    divider.style.cssText = `height: 1px; background: ${colors.divider}; flex-shrink: 0;`;
    popover.appendChild(divider);

    const allBranches = Array.from(new Set([
      ...Object.keys(branchColors).filter(k => k !== 'default'),
      ...discoveredBranches
    ])).sort();

    if (allBranches.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'Noch keine Branches erkannt.';
      empty.style.cssText = `padding: 14px; font-size: 12px; color: ${colors.muted};`;
      popover.appendChild(empty);
      return;
    }

    const searchWrapper = document.createElement('div');
    searchWrapper.style.cssText = `padding: 10px 14px; flex-shrink: 0;`;

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Filter branches';
    searchInput.style.cssText = `
      width: 100%;
      padding: 6px 10px;
      background: ${colors.inputBg};
      border: 1px solid ${colors.inputBorder};
      border-radius: 6px;
      color: ${colors.text};
      font-size: 13px;
    `;
    searchInput.addEventListener('focus', () => {
      searchInput.style.borderColor = colors.focusRing;
      searchInput.style.boxShadow = `0 0 0 3px ${colors.focusRing}33`;
    });
    searchInput.addEventListener('blur', () => {
      searchInput.style.borderColor = colors.inputBorder;
      searchInput.style.boxShadow = 'none';
    });
    searchWrapper.appendChild(searchInput);
    popover.appendChild(searchWrapper);

    const listContainer = document.createElement('div');
    listContainer.style.cssText = `overflow-y: auto; padding: 4px 8px 8px;`;
    popover.appendChild(listContainer);

    const selected = new Set(getSelectedBaseBranches());

    allBranches.forEach(branch => {
      const row = document.createElement('label');
      row.dataset.branchName = branch.toLowerCase();
      row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        color: ${colors.text};
      `;
      row.addEventListener('mouseenter', () => { row.style.backgroundColor = colors.hover; });
      row.addEventListener('mouseleave', () => { row.style.backgroundColor = 'transparent'; });

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(branch);
      checkbox.style.cssText = 'cursor: pointer; margin: 0; flex-shrink: 0;';

      const dot = document.createElement('span');
      dot.style.cssText = `
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
        background-color: ${branchColors[branch] || branchColors.default};
      `;

      const label = document.createElement('span');
      label.textContent = branch;
      label.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

      checkbox.addEventListener('change', () => {
        const current = new Set(getSelectedBaseBranches());
        if (checkbox.checked) current.add(branch);
        else current.delete(branch);
        navigateToQuery(buildQueryForBaseBranches(Array.from(current)));
      });

      row.appendChild(checkbox);
      row.appendChild(dot);
      row.appendChild(label);
      listContainer.appendChild(row);
    });

    searchInput.addEventListener('input', () => {
      const term = searchInput.value.trim().toLowerCase();
      listContainer.querySelectorAll('label').forEach(row => {
        row.style.display = row.dataset.branchName.includes(term) ? 'flex' : 'none';
      });
    });
  }

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = popover.style.display !== 'flex';
    document.querySelectorAll('.base-branch-filter-popover').forEach(p => { p.style.display = 'none'; });
    if (willOpen) {
      renderPopoverContent();
      popover.style.display = 'flex';
    }
  });

  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      closePopover();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
  });

  wrapper.appendChild(button);
  wrapper.appendChild(popover);
  filterHeader.insertBefore(wrapper, authorButton);
}

function refreshFilterUI() {
  ensureBaseBranchFilterButton();
}

// Load colors from storage
function loadColorSettings(callback) {
  chrome.storage.local.get('branchColors', (result) => {
    if (result.branchColors) {
      branchColors = result.branchColors;
    }
    if (callback) callback();
  });
}

function loadGithubToken(callback) {
  chrome.storage.local.get('githubToken', (result) => {
    githubToken = result.githubToken || '';
    if (callback) callback();
  });
}

// Listen for reload signal from popup
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'reloadBadges') {
    // Existing badges already have the old color baked in as inline styles,
    // so they must be removed before re-adding — setupPRBadges() skips rows
    // that already have a badge.
    document.querySelectorAll('.base-branch-badge').forEach(el => el.remove());
    processedPRs.clear();
    loadGithubToken(() => {
      loadColorSettings(() => {
        setupPRBadges();
        refreshFilterUI();
      });
    });
  }
});

// Initial setup
// loadGithubToken() must finish before any fetch fires, otherwise the first
// PR lookups go out unauthenticated (hitting the 60/h limit instead of the
// token's 5000/h) — chrome.storage.local.get is async and isn't guaranteed
// to beat a fixed setTimeout.
loadDiscoveredBranches();
loadGithubToken(() => {
  loadColorSettings(() => {
    setTimeout(() => {
      setupPRBadges();
      refreshFilterUI();
    }, 100);
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
  document.querySelectorAll('.base-branch-badge').forEach(el => el.remove());
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
