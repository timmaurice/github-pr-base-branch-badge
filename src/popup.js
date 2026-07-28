import { I18N_DEFAULT_LANG, i18nReady, i18nText } from './shared/i18n.js';
import { repoKeyFromPath } from './shared/repoKey.js';

// See CLAUDE.md's "Branch colors" section for the full per-repo storage
// scheme (REPO_TEMPLATE_KEY, migration, resolveActiveRepoKey fallback chain).
function repoStorageKey(repoKey) {
  return `repoBranchColors:${repoKey}`;
}
const REPO_TEMPLATE_KEY = 'repoBranchColorsTemplate';

const DEFAULT_COLORS = {
  main: '#10b981',
  develop: '#f97316',
  staging: '#3b82f6',
  'release/*': '#ef4444',
  default: '#6b7280'
};

// A brand-new repo's seed: just the fallback color, no guessed example
// branches (see CLAUDE.md's "Branch colors" for why) — real names come from
// suggestions instead (renderDiscoveredBranches()/scanBranches() below).
const EMPTY_SEED_COLORS = { default: DEFAULT_COLORS.default };

const NEW_BRANCH_PALETTE = ['#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f59e0b', '#14b8a6'];
let paletteIndex = 0;

// Current UI language and the branch-color map currently rendered — kept in
// memory so a language switch can re-render immediately without a storage
// round-trip.
let currentLang = I18N_DEFAULT_LANG;
let currentColors = EMPTY_SEED_COLORS;
let currentDiscovered = [];
// "owner/repo" of the repo currently being configured, or null when editing
// the shared template (see resolveActiveRepoKey/loadSettings).
let currentRepoKey = null;

function t(key, args) {
  return i18nText(currentLang, key, args);
}

const list = document.getElementById('branches-list');
const tokenInput = document.getElementById('github-token');
const tokenToggleBtn = document.getElementById('token-toggle-btn');
const tokenTestBtn = document.getElementById('token-test-btn');
const tokenTestResult = document.getElementById('token-test-result');
const languageSelect = document.getElementById('language-select');
const clearDiscoveredBtn = document.getElementById('clear-discovered-btn');
const clearDiscoveredRow = document.getElementById('clear-discovered-row');
const discoveredSection = document.getElementById('discovered-section');
const discoveredTitleText = document.getElementById('discovered-title-text');
const discoveredChips = document.getElementById('discovered-chips');
const repoContext = document.getElementById('repo-context');
const scanBranchesBtn = document.getElementById('scan-branches-btn');

document.getElementById('version-footer').textContent = `v${chrome.runtime.getManifest().version}`;

document.addEventListener('DOMContentLoaded', loadSettings);
document.getElementById('save-btn').addEventListener('click', saveSettings);
document.getElementById('reset-btn').addEventListener('click', resetSettings);
tokenTestBtn.addEventListener('click', testToken);
tokenToggleBtn.addEventListener('click', toggleTokenVisibility);
languageSelect.addEventListener('change', onLanguageChange);
clearDiscoveredBtn.addEventListener('click', clearDiscoveredBranches);
scanBranchesBtn.addEventListener('click', scanBranches);

// Broadcasts a message to every open github.com tab so content.js can react
// (rebuild badges/filter UI) without requiring a manual page reload.
function broadcastToGithubTabs(action) {
  chrome.tabs.query({ url: '*://github.com/*' }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, { action }).catch(() => {});
    });
  });
}

function toggleTokenVisibility() {
  const showing = tokenInput.type === 'text';
  tokenInput.type = showing ? 'password' : 'text';
  tokenToggleBtn.textContent = showing ? '👁' : '🙈';
  tokenToggleBtn.title = showing ? t('tokenShowLabel') : t('tokenHideLabel');
}

function onLanguageChange() {
  currentLang = languageSelect.value;
  // Synced (not local) so the language choice follows the user to any other
  // machine signed into the same Chrome/Google account — see CLAUDE.md.
  chrome.storage.sync.set({ uiLanguage: currentLang }, () => {
    i18nReady(currentLang, () => {
      applyStaticTranslations();
      renderRepoContext();
      renderRows(currentColors);
      broadcastToGithubTabs('reloadBadges');
    });
  });
}

function clearDiscoveredBranches() {
  if (!currentRepoKey || !window.confirm(t('clearDiscoveredConfirm'))) return;

  chrome.storage.local.set({ [`discoveredBranches:${currentRepoKey}`]: [] }, () => {
    currentDiscovered = [];
    renderDiscoveredBranches();
    broadcastToGithubTabs('clearDiscoveredBranches');
    showStatus(t('clearDiscoveredDone'), 'success');
  });
}

// Names that already have a row in the popup right now, saved or not — used
// to hide a discovered-branch suggestion the moment it's added (see
// addSuggestedBranch()), rather than waiting for Save.
function currentRowNames() {
  return new Set(
    Array.from(list.querySelectorAll('.branch-name-input'))
      .map((el) => el.value.trim())
      .filter(Boolean)
  );
}

// Suggestions: branches with no row yet (see CLAUDE.md's "Branch colors").
// The header (title + scan button) stays visible with zero suggestions too,
// whenever a repo is active — scanning is most useful exactly then.
function renderDiscoveredBranches() {
  const coloredNames = currentRowNames();
  const extras = currentRepoKey
    ? currentDiscovered.filter((name) => !coloredNames.has(name)).sort()
    : [];

  clearDiscoveredRow.style.display = currentRepoKey ? '' : 'none';
  discoveredSection.style.display = currentRepoKey ? '' : 'none';
  discoveredChips.innerHTML = '';
  discoveredChips.style.display = extras.length ? '' : 'none';

  extras.forEach((branch) => {
    const chip = document.createElement('span');
    chip.className = 'discovered-chip';

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'discovered-chip-label';
    label.textContent = branch;
    label.title = t('addSuggestedBranchTitle');
    label.addEventListener('click', () => addSuggestedBranch(branch));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'discovered-chip-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = t('removeDiscoveredTitle');
    removeBtn.setAttribute('aria-label', t('removeDiscoveredAriaLabel', { name: branch }));
    removeBtn.addEventListener('click', () => removeDiscoveredBranch(branch));

    chip.append(label, removeBtn);
    discoveredChips.appendChild(chip);
  });
}

function addSuggestedBranch(branch) {
  addBranchRow(branch);
  renderDiscoveredBranches();
}

function removeDiscoveredBranch(branch) {
  if (!currentRepoKey) return;
  currentDiscovered = currentDiscovered.filter((name) => name !== branch);
  chrome.storage.local.set({ [`discoveredBranches:${currentRepoKey}`]: currentDiscovered }, () => {
    renderDiscoveredBranches();
    broadcastToGithubTabs('discoveredBranchesChanged');
  });
}

const SCAN_BRANCHES_MAX_PAGES = 10; // 1000 PRs at 100/page — plenty for any real repo

// Distinct base branches actually targeted by PRs (state=all), not every git
// branch in the repo — see CLAUDE.md's "Branch colors" for why. Paginates
// via the Link header, capped at SCAN_BRANCHES_MAX_PAGES; `truncated` tells
// the caller whether the cap was hit.
async function fetchRecentBaseBranches(repoKey, token) {
  const [owner, repo] = repoKey.split('/');
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const branches = new Set();
  let url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=100`;
  let pageCount = 0;

  while (url && pageCount < SCAN_BRANCHES_MAX_PAGES) {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const data = await response.json();
    data.forEach((pr) => {
      if (pr.base && pr.base.ref) branches.add(pr.base.ref);
    });

    const nextMatch = (response.headers.get('link') || '').match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
    pageCount++;
  }

  return { branches: Array.from(branches), truncated: Boolean(url) };
}

async function scanBranches() {
  if (!currentRepoKey) {
    showStatus(t('scanBranchesNoRepo'), 'error');
    return;
  }

  scanBranchesBtn.disabled = true;
  scanBranchesBtn.textContent = t('scanningBranches');

  try {
    const { branches, truncated } = await fetchRecentBaseBranches(
      currentRepoKey,
      tokenInput.value.trim()
    );
    currentDiscovered = Array.from(new Set([...currentDiscovered, ...branches]));

    chrome.storage.local.set(
      { [`discoveredBranches:${currentRepoKey}`]: currentDiscovered },
      () => {
        renderDiscoveredBranches();
        broadcastToGithubTabs('discoveredBranchesChanged');
        showStatus(
          t(truncated ? 'scanBranchesDoneTruncated' : 'scanBranchesDone', {
            count: branches.length
          }),
          'success'
        );
      }
    );
  } catch (err) {
    showStatus(t('scanBranchesFailed', { message: err.message }), 'error');
  } finally {
    scanBranchesBtn.disabled = false;
    scanBranchesBtn.textContent = t('scanBranchesBtn');
  }
}

// Applies translated text to the elements that don't get rebuilt by
// renderRows() (header, token section, action buttons, etc).
function applyStaticTranslations() {
  document.documentElement.lang = currentLang;
  languageSelect.value = currentLang;
  languageSelect.title = t('languageLabel');

  document.getElementById('token-optional-text').textContent = t('tokenOptional');
  tokenTestBtn.textContent = t('tokenTestBtn');
  tokenToggleBtn.title = tokenInput.type === 'text' ? t('tokenHideLabel') : t('tokenShowLabel');
  document.getElementById('token-hint-text').innerHTML = t('tokenHintHtml');
  document.getElementById('save-btn').textContent = t('saveBtn');
  document.getElementById('reset-btn').textContent = t('resetBtn');
  clearDiscoveredBtn.textContent = t('clearDiscoveredBtn');
  discoveredTitleText.textContent = t('discoveredSectionTitle');
  scanBranchesBtn.textContent = t('scanBranchesBtn');
  scanBranchesBtn.title = t('scanBranchesTitle');
}

// Verifies the token in the input field (not the saved one) against the
// GitHub API: /user confirms authentication and the rate-limit headers on
// that same response show the available quota.
async function testToken() {
  const token = tokenInput.value.trim();

  tokenTestBtn.disabled = true;
  tokenTestBtn.textContent = t('tokenTesting');
  tokenTestResult.className = 'token-test-result';

  try {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch('https://api.github.com/user', { headers });
    const limit = response.headers.get('x-ratelimit-limit');
    const remaining = response.headers.get('x-ratelimit-remaining');
    const quota = limit ? t('rateLimitSuffix', { remaining, limit }) : '';

    if (!token) {
      showTokenResult(
        response.status === 401
          ? t('tokenTestNoToken', { quota })
          : t('tokenTestUnexpected', { status: response.status }),
        'error'
      );
    } else if (response.ok) {
      const user = await response.json();
      showTokenResult(t('tokenTestValid', { login: user.login, quota }), 'success');
    } else if (response.status === 401) {
      showTokenResult(t('tokenTestInvalid'), 'error');
    } else {
      showTokenResult(t('tokenTestFailed', { status: response.status, quota }), 'error');
    }
  } catch (err) {
    showTokenResult(t('tokenTestNetworkError', { message: err.message }), 'error');
  } finally {
    tokenTestBtn.disabled = false;
    tokenTestBtn.textContent = t('tokenTestBtn');
  }
}

function showTokenResult(message, type) {
  tokenTestResult.textContent = message;
  tokenTestResult.className = `token-test-result ${type}`;
}

// Which repo's config the popup edits — see CLAUDE.md's "Branch colors" for
// the fallback chain (active tab → last-edited repo → template).
function resolveActiveRepoKey(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    const fromTab = tab && tab.url ? repoKeyFromPath(new URL(tab.url).pathname) : null;
    if (fromTab) {
      callback(fromTab);
      return;
    }
    chrome.storage.local.get('lastActiveRepoKey', (result) => {
      callback(result.lastActiveRepoKey || null);
    });
  });
}

function loadSettings() {
  resolveActiveRepoKey((repoKey) => {
    currentRepoKey = repoKey;
    const colorsKey = repoKey ? repoStorageKey(repoKey) : REPO_TEMPLATE_KEY;
    const discoveredKey = repoKey ? `discoveredBranches:${repoKey}` : null;

    // See CLAUDE.md's "Branch colors" for why colors/language are sync but
    // token/discoveredBranches stay local.
    chrome.storage.local.get(
      ['githubToken', discoveredKey, 'branchColors', 'uiLanguage'].filter(Boolean),
      (localResult) => {
        chrome.storage.sync.get(
          [colorsKey, REPO_TEMPLATE_KEY, 'branchColors', 'uiLanguage'],
          (syncResult) => {
            currentLang = syncResult.uiLanguage || localResult.uiLanguage || I18N_DEFAULT_LANG;
            currentColors =
              syncResult[colorsKey] ||
              syncResult[REPO_TEMPLATE_KEY] ||
              syncResult.branchColors ||
              localResult.branchColors ||
              EMPTY_SEED_COLORS;
            currentDiscovered = (discoveredKey && localResult[discoveredKey]) || [];

            // One-time migrations for installs from before this feature (or
            // before sync support) existed — see CLAUDE.md's "Branch colors".
            if (!syncResult[REPO_TEMPLATE_KEY]) {
              const legacy = syncResult.branchColors || localResult.branchColors;
              if (legacy) chrome.storage.sync.set({ [REPO_TEMPLATE_KEY]: legacy });
            }
            if (!syncResult.uiLanguage && localResult.uiLanguage) {
              chrome.storage.sync.set({ uiLanguage: localResult.uiLanguage });
            }

            // Persist a brand-new repo's seeded colors right away, so
            // reopening the popup shows the same values even before Save.
            if (repoKey && !syncResult[colorsKey]) {
              chrome.storage.sync.set({ [colorsKey]: currentColors });
            }
            if (repoKey) {
              chrome.storage.local.set({ lastActiveRepoKey: repoKey });
            }

            i18nReady(currentLang, () => {
              applyStaticTranslations();
              renderRepoContext();
              renderRows(currentColors);
              renderDiscoveredBranches();
              tokenInput.value = localResult.githubToken || '';
            });
          }
        );
      }
    );
  });
}

function renderRepoContext() {
  repoContext.textContent = currentRepoKey
    ? t('repoContextLabel', { repo: currentRepoKey })
    : t('repoContextTemplateLabel');
}

function renderRows(colors) {
  list.innerHTML = '';

  const entries = Object.entries(colors).filter(([name]) => name !== 'default');
  const defaultColor = colors.default || DEFAULT_COLORS.default;

  entries.forEach(([name, color]) => {
    list.appendChild(buildRow(name, color, false));
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'add-branch-btn';
  addBtn.textContent = t('addBranchBtn');
  addBtn.addEventListener('click', () => addBranchRow());
  list.appendChild(addBtn);

  list.appendChild(buildRow('default', defaultColor, true));

  validateAllNameFields();
}

// The row currently being dragged, set on dragstart and read by every other
// row's dragover/drop handler — there's only ever one drag in flight in
// this popup, so a module-level ref is simpler than threading it through
// dataTransfer (which can't carry a live DOM reference anyway).
let draggedRow = null;

function clearDropIndicators() {
  list.querySelectorAll('.drop-indicator-before, .drop-indicator-after').forEach((el) => {
    el.classList.remove('drop-indicator-before', 'drop-indicator-after');
  });
}

// Moves `draggedRowEl` next to `targetRowEl` (before/after per `before`).
// Each row is now a single wrapper element (see buildRow), so this is a
// plain DOM move — no index bookkeeping or rebuilding through the
// branchColors object needed (which would require unique keys and could
// silently collapse rows sharing a duplicate/empty name while mid-edit).
function moveRowTo(draggedRowEl, targetRowEl, before) {
  if (draggedRowEl === targetRowEl) return;
  list.insertBefore(draggedRowEl, before ? targetRowEl : targetRowEl.nextSibling);
}

// Flags empty or duplicate branch names as the user types, so mistakes
// are visible immediately instead of only after clicking "Save".
function validateAllNameFields() {
  const inputs = Array.from(list.querySelectorAll('.branch-name-input'));
  const valueCounts = {};

  inputs.forEach((el) => {
    const value = el.value.trim();
    if (value) valueCounts[value] = (valueCounts[value] || 0) + 1;
  });

  inputs.forEach((el) => {
    const value = el.value.trim();
    const isInvalid = !value || valueCounts[value] > 1;
    el.classList.toggle('invalid', isInvalid);
  });
}

function buildRow(name, color, isDefault) {
  const rowEl = document.createElement('div');
  rowEl.className = isDefault ? 'branch-row branch-row--default' : 'branch-row';

  // Priority among matching wildcard patterns is the row order (top wins,
  // see resolveBranchColor() in src/content/utils.js) — this handle is how
  // the user controls that order, via native HTML5 drag-and-drop. It's a
  // dedicated grab point (rather than the row as a whole) so that starting
  // a drag from the name/color inputs doesn't fight with text selection.
  const dragHandle = document.createElement('span');
  dragHandle.className = 'drag-handle';
  dragHandle.textContent = '⠿';

  let nameEl;
  if (isDefault) {
    nameEl = document.createElement('span');
    nameEl.className = 'branch-name';
    nameEl.textContent = t('defaultRowLabel');
    nameEl.title = t('defaultRowTitle');
    dragHandle.style.visibility = 'hidden';
  } else {
    nameEl = document.createElement('input');
    nameEl.type = 'text';
    nameEl.className = 'branch-name-input';
    nameEl.value = name;
    nameEl.placeholder = t('namePlaceholder');
    nameEl.title = t('namePatternHint');

    dragHandle.draggable = true;
    dragHandle.title = t('dragHandleTitle');
    dragHandle.setAttribute('aria-label', t('dragHandleAriaLabel'));

    dragHandle.addEventListener('dragstart', (e) => {
      draggedRow = rowEl;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
      // Drag the whole row as the ghost image, not just this small handle.
      const rect = rowEl.getBoundingClientRect();
      e.dataTransfer.setDragImage(rowEl, e.clientX - rect.left, e.clientY - rect.top);
      rowEl.classList.add('dragging');
    });

    dragHandle.addEventListener('dragend', () => {
      rowEl.classList.remove('dragging');
      clearDropIndicators();
      draggedRow = null;
    });
  }

  const swatchWrapper = document.createElement('div');
  swatchWrapper.className = 'color-swatch-wrapper';

  const swatchDisplay = document.createElement('div');
  swatchDisplay.className = 'color-swatch-display';
  swatchDisplay.style.backgroundColor = color;

  const picker = document.createElement('input');
  picker.type = 'color';
  picker.className = 'color-picker';
  picker.value = color;

  swatchWrapper.appendChild(swatchDisplay);
  swatchWrapper.appendChild(picker);

  const hex = document.createElement('input');
  hex.type = 'text';
  hex.className = 'color-text';
  hex.maxLength = 7;
  hex.value = color;

  picker.addEventListener('input', () => {
    hex.value = picker.value;
    swatchDisplay.style.backgroundColor = picker.value;
  });

  hex.addEventListener('change', () => {
    const val = hex.value.trim();
    if (!val.match(/^#[0-9A-Fa-f]{6}$/)) {
      showStatus(t('errorInvalidColor'), 'error');
      hex.value = picker.value;
      return;
    }
    picker.value = val;
    swatchDisplay.style.backgroundColor = val;
  });

  if (!isDefault) {
    nameEl.addEventListener('input', () => {
      validateAllNameFields();
    });
  }

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-btn';

  if (isDefault) {
    removeBtn.style.visibility = 'hidden';
  } else {
    removeBtn.textContent = '✕';
    removeBtn.title = t('removeBranchTitle');
    removeBtn.setAttribute('aria-label', t('removeBranchAriaLabel', { name }));
    removeBtn.addEventListener('click', () => {
      rowEl.remove();
      validateAllNameFields();
    });
  }

  rowEl.append(dragHandle, nameEl, swatchWrapper, hex, removeBtn);

  if (!isDefault) {
    rowEl.addEventListener('dragenter', (e) => e.preventDefault());

    rowEl.addEventListener('dragover', (e) => {
      if (!draggedRow || draggedRow === rowEl) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = rowEl.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      clearDropIndicators();
      rowEl.classList.add(before ? 'drop-indicator-before' : 'drop-indicator-after');
    });

    rowEl.addEventListener('drop', (e) => {
      if (!draggedRow || draggedRow === rowEl) return;
      e.preventDefault();
      const rect = rowEl.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      moveRowTo(draggedRow, rowEl, before);
      clearDropIndicators();
    });
  }

  return rowEl;
}

// `name` prefills a suggested branch (see addSuggestedBranch()); an empty
// name is the plain "+ Add branch" case, where the input is focused so
// typing can start immediately — a prefilled row is already complete, so
// it isn't forced into focus.
function addBranchRow(name = '') {
  const addBtn = list.querySelector('.add-branch-btn');
  const color = NEW_BRANCH_PALETTE[paletteIndex % NEW_BRANCH_PALETTE.length];
  paletteIndex++;

  const row = buildRow(name, color, false);
  list.insertBefore(row, addBtn);

  if (!name) {
    const newNameInput = row.querySelector('.branch-name-input');
    if (newNameInput) newNameInput.focus();
  }

  validateAllNameFields();
}

function saveSettings() {
  const colors = {};
  const rows = Array.from(list.querySelectorAll('.branch-row'));

  const seenNames = new Set();
  let hasError = false;

  rows.forEach((row) => {
    const isDefault = row.classList.contains('branch-row--default');
    const nameEl = row.querySelector(isDefault ? '.branch-name' : '.branch-name-input');
    const hexEl = row.querySelector('.color-text');
    const key = isDefault ? 'default' : nameEl.value.trim();

    if (!isDefault) {
      if (!key) return;
      if (seenNames.has(key)) {
        showStatus(t('errorDuplicate', { name: key }), 'error');
        hasError = true;
        return;
      }
      seenNames.add(key);
    }

    colors[key] = hexEl.value.trim();
  });

  if (hasError) return;

  const githubToken = tokenInput.value.trim();
  const colorsKey = currentRepoKey ? repoStorageKey(currentRepoKey) : REPO_TEMPLATE_KEY;

  chrome.storage.local.set({ githubToken }, () => {
    chrome.storage.sync.set({ [colorsKey]: colors }, () => {
      currentColors = colors;
      showStatus(t('statusSaved'), 'success');
      renderRows(colors);
      renderDiscoveredBranches();
      broadcastToGithubTabs('reloadBadges');
    });
  });
}

function resetSettings() {
  if (!window.confirm(t('confirmReset'))) return;

  const colorsKey = currentRepoKey ? repoStorageKey(currentRepoKey) : REPO_TEMPLATE_KEY;

  chrome.storage.sync.set({ [colorsKey]: EMPTY_SEED_COLORS }, () => {
    currentColors = EMPTY_SEED_COLORS;
    renderRows(EMPTY_SEED_COLORS);
    renderDiscoveredBranches();
    showStatus(t('statusReset'), 'success');
    broadcastToGithubTabs('reloadBadges');
  });
}

function showStatus(message, type = '') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${type}`;

  if (type === 'success') {
    setTimeout(() => {
      status.textContent = '';
      status.className = 'status';
    }, 2000);
  }
}
