// Branch-name patterns shared by the content script (badge colors, filter
// dropdown) and the popup (suggestions): an exact name, or `*` as a wildcard
// for any run of characters (e.g. "release/*" matches "release/1.0").

export function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

// Parses the popup's free-text ignore field ("release/*, feature/*") into a
// deduplicated pattern list. Commas and whitespace both separate entries —
// git ref names can't contain whitespace, and a comma in a branch name is
// rare enough not to be worth a quoting syntax.
export function parseBranchPatterns(text) {
  return Array.from(
    new Set(
      String(text || '')
        .split(/[\s,]+/)
        .map((p) => p.trim())
        .filter(Boolean)
    )
  );
}

export function isBranchIgnored(patterns, branchName) {
  return (patterns || []).some((pattern) =>
    pattern.includes('*') ? wildcardToRegExp(pattern).test(branchName) : pattern === branchName
  );
}
