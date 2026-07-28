// --- Base branch query helpers -------------------------------------------
// GitHub treats repeated `base:` qualifiers as OR (not AND), so selecting
// several branches is just multiple "base:x" tokens — e.g. "base:master
// base:beta" already matches PRs targeting either branch.

export function getSelectedBaseBranches() {
  const params = new URLSearchParams(window.location.search);
  const query = params.get('q') || '';
  const matches = query.match(/base:([a-zA-Z0-9\-_./]+)/g) || [];
  return matches.map((m) => m.slice('base:'.length));
}

export function removeBaseFilters(query) {
  return query
    .replace(/base:[a-zA-Z0-9\-_./]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Shared with filterDropdown.js's per-branch PR-count fetch, so both the
// query builder and the count query match whichever state (open/closed)
// the current search is actually showing.
export function isClosedQuery(query) {
  return /\bis:closed\b/.test(query);
}

export function buildQueryForBaseBranches(branches, originalQuery) {
  // window.location is only read when the caller doesn't supply
  // originalQuery — a plain `const params = new URLSearchParams(...)` above
  // this would read it unconditionally, making the function needlessly
  // coupled to a page context even when called with an explicit query.
  const original = originalQuery ?? new URLSearchParams(window.location.search).get('q') ?? '';
  const isClosed = isClosedQuery(original);

  const query = removeBaseFilters(original);

  if (branches.length === 0) {
    return query;
  }

  const group = branches.map((b) => `base:${b}`).join(' ');

  if (query) {
    return `${query} ${group}`;
  }
  return `is:pr ${group} ${isClosed ? 'is:closed' : 'is:open'}`;
}

export function navigateToQuery(query) {
  const params = new URLSearchParams(window.location.search);
  params.set('q', query);
  // A new filter changes the result count, so a `page` left over from
  // before can point past the new last page (GitHub then just shows
  // nothing) — drop it and let GitHub redirect to page 1, same as it does
  // when you edit the search box directly.
  params.delete('page');
  window.location.search = params.toString();
}
