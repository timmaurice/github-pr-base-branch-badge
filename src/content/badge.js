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
import { adjustColor, resolveBranchColor, getContrastTextColor } from './utils.js';
import { graphqlRequest } from './githubApi.js';

// Resolves badges for every not-yet-processed row from cache (memory or
// storage, both local — no network), then fetches whatever's left over the
// network. A GitHub PR list page is always a single repo, so any leftover
// PRs share one owner/repo, and — if a token is set — GitHub's GraphQL API
// can fetch all of their base branches in a SINGLE request (aliased
// `pullRequest(number: ...)` fields) instead of one REST call per PR. This
// is the main lever against the secondary/abuse rate limit: it's triggered
// by request frequency, not total data fetched, so collapsing e.g. 25
// requests into 1 helps far more than any per-request optimization would.
// GraphQL requires auth, though (unauthenticated requests are rejected
// outright), so without a token — or if the batch request itself fails —
// this falls back to the original one-REST-call-per-PR flow, sequential on
// purpose since parallel REST requests reliably tripped the same rate limit
// even with plenty of primary quota left.
export async function setupPRBadges() {
  const prRows = document.querySelectorAll('.Box-row');
  const pending = [];

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
      addBaseBranchBadge(prRow, prLink, branchCache.get(prUrl));
      continue;
    }

    const cachedBranch = await getCachedBranch(prUrl);
    if (cachedBranch) {
      branchCache.set(prUrl, cachedBranch);
      addBaseBranchBadge(prRow, prLink, cachedBranch);
      continue;
    }

    const parsed = parsePRUrl(prUrl);
    if (!parsed) {
      console.warn(`Base Branch Badge: could not parse PR URL: ${prUrl}`);
      continue;
    }

    pending.push({ prUrl, prRow, prLink, parsed });
  }

  if (pending.length === 0) return;

  if (githubToken) {
    await fetchPendingViaGraphQL(pending);
  } else {
    for (const item of pending) {
      await fetchAndExtractBaseBranch(item.prUrl, item.prRow, item.prLink);
    }
  }
}

// prUrl is whatever the PR link's raw href attribute was. GitHub renders
// this root-relative ("/owner/repo/pull/1") on PR list pages, but as a full
// absolute URL on other pages that link to PRs (e.g. the related-PRs list on
// a /compare/... page) — parse via the URL constructor rather than a
// path-only regex so both forms resolve the same way.
function parsePRUrl(prUrl) {
  let pathname;
  try {
    pathname = new URL(prUrl, window.location.origin).pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  const [, owner, repo, number] = match;
  return { owner, repo, number };
}

// Groups pending PRs by repo (in practice always one group — a PR list page
// is always a single repo — but grouping defensively costs nothing) and
// fires one GraphQL request per group.
async function fetchPendingViaGraphQL(pending) {
  const groups = new Map();
  for (const item of pending) {
    const key = `${item.parsed.owner}/${item.parsed.repo}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  for (const items of groups.values()) {
    await fetchRepoBaseBranchesGraphQL(items);
  }
}

async function fetchRepoBaseBranchesGraphQL(items) {
  const { owner, repo } = items[0].parsed;
  // JSON.stringify safely quotes/escapes owner/repo as GraphQL string
  // literals; `number` is regex-restricted to digits in parsePRUrl, so it's
  // safe to interpolate directly as an integer literal.
  const fields = items
    .map((item, i) => `pr${i}: pullRequest(number: ${item.parsed.number}) { baseRefName }`)
    .join('\n');
  const query = `query {
  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) {
    ${fields}
  }
}`;

  try {
    const response = await graphqlRequest(query, githubToken);

    if (!response.ok) {
      console.warn(
        `Base Branch Badge: GraphQL batch request failed (${response.status}) for ${owner}/${repo} — falling back to individual requests.`
      );
      await fetchItemsIndividually(items);
      return;
    }

    const payload = await response.json();
    const repoData = payload.data && payload.data.repository;

    if (payload.errors) {
      // GraphQL can return partial data alongside per-field errors (e.g. one
      // PR number that no longer exists) — log once, then let the per-item
      // "missing baseRefName" fallback below handle whichever ones failed.
      console.warn(
        `Base Branch Badge: GraphQL returned errors for ${owner}/${repo}`,
        payload.errors
      );
    }

    const misses = [];
    items.forEach((item, i) => {
      const baseBranch = repoData && repoData[`pr${i}`] && repoData[`pr${i}`].baseRefName;
      if (baseBranch) {
        branchCache.set(item.prUrl, baseBranch);
        setCachedBranch(item.prUrl, baseBranch);
        addBaseBranchBadge(item.prRow, item.prLink, baseBranch);
      } else {
        misses.push(item);
      }
    });

    if (misses.length > 0) await fetchItemsIndividually(misses);
  } catch (error) {
    console.error('Base Branch Badge: error fetching PR batch via GraphQL', error);
    await fetchItemsIndividually(items);
  }
}

async function fetchItemsIndividually(items) {
  for (const item of items) {
    await fetchAndExtractBaseBranch(item.prUrl, item.prRow, item.prLink);
  }
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
  // selection) — the toolbar dropdown is the tool for multi-select. Built as
  // an absolute /owner/repo/pulls path (from prLink's own href) rather than
  // a page-relative "?q=..." one, since setupPRBadges() also badges PR rows
  // on pages other than /pulls itself (e.g. the related-PRs list on a
  // /compare/... page) — a relative href there would resolve against the
  // /compare/... URL instead of navigating to the PR list at all.
  const parsedLink = parsePRUrl(prLink.getAttribute('href'));
  const listPath = parsedLink ? `/${parsedLink.owner}/${parsedLink.repo}/pulls` : '';
  badge.href = `${listPath}?q=${encodeURIComponent(buildQueryForBaseBranches([baseBranch]))}`;
  badge.title = i18nText(uiLanguage, 'badgeTitle', { branch: baseBranch });

  // Per-branch color as custom properties rather than a full style.cssText
  // block, so styles.css still owns :hover/:active (see CLAUDE.md).
  const textColor = getContrastTextColor(bgColor);
  badge.style.setProperty('--badge-bg', bgColor);
  badge.style.setProperty('--badge-border', adjustColor(bgColor, -20));
  badge.style.setProperty('--badge-hover-bg', adjustColor(bgColor, 20));
  badge.style.setProperty('--badge-text', textColor);
  badge.classList.toggle('base-branch-badge--dark-text', textColor !== '#ffffff');

  prLink.parentNode.insertBefore(badge, prLink.nextSibling);
}
