import { i18nText } from '../shared/i18n.js';
import {
  processedPRs,
  branchCache,
  branchColors,
  githubToken,
  uiLanguage,
  PULL_REQUEST_ICON_SVG,
  rememberDiscoveredBranch
} from './state.js';
import { getCachedBranch, setCachedBranch } from './storageCache.js';
import { buildQueryForBaseBranches } from './query.js';
import { adjustColor, resolveBranchColor } from './utils.js';

// Fetch PR details and add base branch badge. Sequential on purpose — firing
// one request per row in parallel (a PR list page easily has 25+) reliably
// tripped GitHub's secondary/abuse rate limit even with a fresh token that
// had plenty of primary quota left.
export async function setupPRBadges() {
  const prRows = document.querySelectorAll('.Box-row');

  for (const prRow of prRows) {
    if (prRow.querySelector('.base-branch-badge')) {
      continue;
    }

    const prLink = prRow.querySelector('a[href*="/pull/"]');
    if (!prLink) continue;

    const prUrl = prLink.getAttribute('href');

    if (processedPRs.has(prUrl)) {
      continue;
    }

    processedPRs.add(prUrl);

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
      } catch {
        // Body wasn't JSON — proceed without it.
      }

      if (ssoHeader) {
        const ssoUrlMatch = ssoHeader.match(/url=(\S+)/);
        const ssoUrl = ssoUrlMatch ? ssoUrlMatch[1] : `https://github.com/orgs/${owner}/sso`;
        console.warn(
          `Base Branch Badge: the token isn't authorized for SSO on "${owner}" (${prLabel}) — open ${ssoUrl}, click "Authorize", then reload the page.`
        );
      } else if (response.status === 404 && !githubToken) {
        console.warn(
          `Base Branch Badge: 404 for ${prLabel} — private repos need a GitHub token in the extension popup settings.`
        );
      } else if (response.status === 404 && githubToken) {
        console.warn(
          `Base Branch Badge: 404 for ${prLabel} despite a token being set — for organization-owned repos, a fine-grained token needs the org's approval (Settings → Personal access tokens, on the org) or use a classic token with the "repo" scope instead.`
        );
      } else if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        const resetHeader = response.headers.get('x-ratelimit-reset');
        const resetTime = resetHeader
          ? new Date(Number(resetHeader) * 1000).toLocaleTimeString()
          : 'unknown';
        console.warn(
          `Base Branch Badge: primary API rate limit exhausted for ${prLabel} — resets at ${resetTime}. Add/replace the token in the extension popup settings for a higher limit.`
        );
      } else if (response.status === 403 && /secondary rate limit|abuse/i.test(apiMessage)) {
        console.warn(
          `Base Branch Badge: hit GitHub's secondary rate limit for ${prLabel} (too many requests too quickly) — retrying automatically on the next scroll/scan.`
        );
        // Transient — unmark as processed so the next MutationObserver-triggered
        // setupPRBadges() pass (e.g. on scroll) picks this row up again.
        processedPRs.delete(prUrl);
      } else if (response.status === 403) {
        console.warn(
          `Base Branch Badge: 403 for ${prLabel}${apiMessage ? ` — ${apiMessage}` : ''}`
        );
      } else {
        console.warn(
          `Base Branch Badge: API request failed (${response.status}) for ${prLabel}${apiMessage ? ` — ${apiMessage}` : ''}`
        );
      }
      return;
    }

    const data = await response.json();
    const baseBranch = data.base && data.base.ref;

    if (baseBranch) {
      branchCache.set(prUrl, baseBranch);
      setCachedBranch(prUrl, baseBranch);
      addBaseBranchBadge(prRow, prLink, baseBranch);
    } else {
      console.warn(
        `Base Branch Badge: API response missing base.ref for ${owner}/${repo}#${number}`
      );
    }
  } catch (error) {
    console.error('Base Branch Badge: error fetching PR from API', error);
    // Network-level failures (offline, DNS hiccup, etc.) are transient —
    // retry on the next scan instead of leaving this row badge-less forever.
    processedPRs.delete(prUrl);
  }
}

function addBaseBranchBadge(prRow, prLink, baseBranch) {
  if (prRow.querySelector('.base-branch-badge')) {
    return;
  }

  baseBranch = baseBranch.trim().split(/\s+/)[0];

  if (!baseBranch || baseBranch.length < 2) {
    return;
  }

  rememberDiscoveredBranch(baseBranch);

  const bgColor = resolveBranchColor(branchColors, baseBranch);

  const badge = document.createElement('a');
  badge.className = 'base-branch-badge';
  // PULL_REQUEST_ICON_SVG is a trusted constant, safe as innerHTML — but
  // baseBranch comes from the GitHub API (an attacker-controlled branch
  // name: git ref rules block spaces/~^:?*[\ but not <>"'&), so it must be
  // set via textContent, never concatenated into the same innerHTML string.
  badge.innerHTML = PULL_REQUEST_ICON_SVG;
  const branchLabel = document.createElement('span');
  branchLabel.textContent = baseBranch;
  badge.appendChild(branchLabel);
  // Clicking a badge selects ONLY this branch (replacing any other
  // selection) — the toolbar dropdown is the tool for multi-select.
  badge.href = `?q=${encodeURIComponent(buildQueryForBaseBranches([baseBranch]))}`;
  badge.title = i18nText(uiLanguage, 'badgeTitle', { branch: baseBranch });

  // Per-branch color as custom properties rather than a full style.cssText
  // block, so styles.css still owns :hover/:active (see CLAUDE.md).
  badge.style.setProperty('--badge-bg', bgColor);
  badge.style.setProperty('--badge-border', adjustColor(bgColor, -20));
  badge.style.setProperty('--badge-hover-bg', adjustColor(bgColor, 20));

  // Insert badge right after the PR link
  prLink.parentNode.insertBefore(badge, prLink.nextSibling);
}
