// Extracts "owner/repo" from a GitHub pathname — restricted to PR/issue
// pages so it can't misidentify GitHub's own routes (/settings/..., ...) as
// a repo (see CLAUDE.md's repoKey.js entry). A bare repo home page returns
// null too; callers needing a best-effort repo there should use a
// last-active fallback instead of trusting a guess here.
export function repoKeyFromPath(pathname) {
  const match = pathname.match(/^\/([^/]+)\/([^/]+)\/(?:pulls?|issues)(?:\/|$)/);
  if (!match) return null;
  const [, owner, repo] = match;
  return `${owner}/${repo}`;
}

// Broader variant for content scripts' own "what repo is THIS page for"
// question (see CLAUDE.md) — badges can render on any repo sub-page a PR
// link appears on (e.g. the related-PRs list on /compare/...), not just
// /pulls, /pull/<n>, or /issues, so state.js/settings.js need this instead
// of repoKeyFromPath() to scope discoveredBranches/branchColors correctly
// there too. A false-positive match on one of GitHub's own non-repo routes
// (/settings/..., /notifications, ...) is harmless for that use: nothing
// reads the resulting key unless a PR row is actually present to badge,
// which never happens on those pages. NOT suitable for the popup's active-
// tab detection (repoKeyFromPath above) — that genuinely must not treat a
// non-repo tab as "editing some repo's colors".
export function repoKeyFromPagePath(pathname) {
  const match = pathname.match(/^\/([^/]+)\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  const [, owner, repo] = match;
  return `${owner}/${repo}`;
}
