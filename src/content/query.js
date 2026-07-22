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

export function buildQueryForBaseBranches(branches, originalQuery) {
  // window.location is only read when the caller doesn't supply
  // originalQuery — a plain `const params = new URLSearchParams(...)` above
  // this would read it unconditionally, making the function needlessly
  // coupled to a page context even when called with an explicit query.
  const original = originalQuery ?? new URLSearchParams(window.location.search).get('q') ?? '';
  const isClosed = /\bis:closed\b/.test(original);

  const query = removeBaseFilters(original);

  if (branches.length === 0) {
    return query;
  }

  // GitHub treats repeated `base:` qualifiers as OR, so no grouping syntax
  // is needed — "base:master base:beta" already matches either branch.
  const group = branches.map((b) => `base:${b}`).join(' ');

  if (query) {
    return `${query} ${group}`;
  }
  return `is:pr ${group} ${isClosed ? 'is:closed' : 'is:open'}`;
}

export function navigateToQuery(query) {
  const params = new URLSearchParams(window.location.search);
  params.set('q', query);
  window.location.search = params.toString();
}
