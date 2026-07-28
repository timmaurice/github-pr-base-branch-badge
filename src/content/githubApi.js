const GRAPHQL_URL = 'https://api.github.com/graphql';

// Shared by badge.js (batched base-branch lookups) and filterDropdown.js
// (batched per-branch PR counts) — both need the same POST-with-token
// shape, so it isn't duplicated per call site.
export function graphqlRequest(query, token) {
  return fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });
}
