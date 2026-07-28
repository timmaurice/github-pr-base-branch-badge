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
