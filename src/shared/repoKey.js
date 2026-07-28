// Extracts "owner/repo" from a GitHub pathname — restricted to pages under a
// repo's PR/issue views (not just any two-segment path), so it doesn't
// misidentify GitHub's own top-level routes that also look like
// /segment/segment (e.g. /settings/profile, /notifications/threads) as a
// repo. This intentionally doesn't try to enumerate every reserved GitHub
// route name — that list isn't public/stable — so a bare repo home page
// (no /pulls, /pull/<n>, or /issues in the path) also returns null; callers
// that need a best-effort repo for that case should fall back to whatever
// repo was last active instead of trusting a guess here.
export function repoKeyFromPath(pathname) {
  const match = pathname.match(/^\/([^/]+)\/([^/]+)\/(?:pulls?|issues)(?:\/|$)/);
  if (!match) return null;
  const [, owner, repo] = match;
  return `${owner}/${repo}`;
}
