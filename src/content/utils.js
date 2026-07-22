export function isPRListPage() {
  return /\/pulls\/?$/.test(window.location.pathname);
}

export function isDarkMode() {
  return (
    document.documentElement.getAttribute('data-color-mode') === 'dark' ||
    document.body.classList.contains('dark') ||
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

// Utility: adjust color brightness
export function adjustColor(color, amount) {
  const c = parseInt(color.substring(1), 16);
  const r = Math.max(0, Math.min(255, (c >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((c >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (c & 0xff) + amount));
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

// Looks up a branch's color, exact name first, then `*`-wildcard patterns
// (e.g. "in*" matches "int", "integration", ...), falling back to `default`.
// When several patterns match, the first one wins in `branchColors`'
// insertion order — i.e. the popup's row order (top to bottom), which the
// user controls with the ▲▼ move buttons.
export function resolveBranchColor(branchColors, branchName) {
  if (Object.prototype.hasOwnProperty.call(branchColors, branchName)) {
    return branchColors[branchName];
  }

  for (const [pattern, color] of Object.entries(branchColors)) {
    if (pattern === 'default' || !pattern.includes('*')) continue;
    if (wildcardToRegExp(pattern).test(branchName)) {
      return color;
    }
  }

  return branchColors.default;
}
