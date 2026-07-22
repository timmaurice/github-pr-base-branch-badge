const DEFAULT_COLORS = {
  qas: '#3b82f6',
  int: '#f97316',
  main: '#10b981',
  preprod: '#ef4444',
  default: '#6b7280'
};

const NEW_BRANCH_PALETTE = ['#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f59e0b', '#14b8a6'];
let paletteIndex = 0;

const list = document.getElementById('branches-list');
const tokenInput = document.getElementById('github-token');
const tokenTestBtn = document.getElementById('token-test-btn');
const tokenTestResult = document.getElementById('token-test-result');

document.addEventListener('DOMContentLoaded', loadSettings);
document.getElementById('save-btn').addEventListener('click', saveSettings);
document.getElementById('reset-btn').addEventListener('click', resetSettings);
tokenTestBtn.addEventListener('click', testToken);

// Verifies the token in the input field (not the saved one) against the
// GitHub API: /user confirms authentication and the rate-limit headers on
// that same response show the available quota.
async function testToken() {
  const token = tokenInput.value.trim();

  tokenTestBtn.disabled = true;
  tokenTestBtn.textContent = 'Teste…';
  tokenTestResult.className = 'token-test-result';

  try {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch('https://api.github.com/user', { headers });
    const limit = response.headers.get('x-ratelimit-limit');
    const remaining = response.headers.get('x-ratelimit-remaining');
    const quota = limit ? ` — Rate-Limit: ${remaining}/${limit} übrig` : '';

    if (!token) {
      showTokenResult(
        response.status === 401
          ? `Kein Token eingetragen — nur öffentliche Repos, Limit 60/h${quota}`
          : `Unerwartete Antwort ohne Token (${response.status})`,
        'error'
      );
    } else if (response.ok) {
      const user = await response.json();
      showTokenResult(`✓ Token gültig — angemeldet als ${user.login}${quota}`, 'success');
    } else if (response.status === 401) {
      showTokenResult('✗ Token ungültig oder abgelaufen (401)', 'error');
    } else {
      showTokenResult(`✗ Test fehlgeschlagen (${response.status})${quota}`, 'error');
    }
  } catch (err) {
    showTokenResult(`✗ Netzwerkfehler: ${err.message}`, 'error');
  } finally {
    tokenTestBtn.disabled = false;
    tokenTestBtn.textContent = 'Testen';
  }
}

function showTokenResult(message, type) {
  tokenTestResult.textContent = message;
  tokenTestResult.className = `token-test-result ${type}`;
}

function loadSettings() {
  chrome.storage.local.get(['branchColors', 'githubToken'], (result) => {
    const colors = result.branchColors || DEFAULT_COLORS;
    renderRows(colors);
    tokenInput.value = result.githubToken || '';
  });
}

function renderRows(colors) {
  list.innerHTML = '';

  const entries = Object.entries(colors).filter(([name]) => name !== 'default');
  const defaultColor = colors.default || DEFAULT_COLORS.default;

  entries.forEach(([name, color], i) => {
    if (i > 0) list.appendChild(divider());
    list.append(...buildRow(name, color, false));
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'add-branch-btn';
  addBtn.textContent = '+ Branch hinzufügen';
  addBtn.addEventListener('click', addBranchRow);
  list.appendChild(addBtn);

  list.appendChild(divider());
  list.append(...buildRow('default', defaultColor, true));

  validateAllNameFields();
}

function divider() {
  const el = document.createElement('div');
  el.className = 'row-divider';
  return el;
}

// Flags empty or duplicate branch names as the user types, so mistakes
// are visible immediately instead of only after clicking "Speichern".
function validateAllNameFields() {
  const inputs = Array.from(list.querySelectorAll('.branch-name-input'));
  const valueCounts = {};

  inputs.forEach(el => {
    const value = el.value.trim();
    if (value) valueCounts[value] = (valueCounts[value] || 0) + 1;
  });

  inputs.forEach(el => {
    const value = el.value.trim();
    const isInvalid = !value || valueCounts[value] > 1;
    el.classList.toggle('invalid', isInvalid);
  });
}

function buildRow(name, color, isDefault) {
  let nameEl;
  if (isDefault) {
    nameEl = document.createElement('span');
    nameEl.className = 'branch-name';
    nameEl.textContent = 'Standard';
    nameEl.title = 'Fallback-Farbe für alle nicht konfigurierten Branches';
  } else {
    nameEl = document.createElement('input');
    nameEl.type = 'text';
    nameEl.className = 'branch-name-input';
    nameEl.value = name;
    nameEl.placeholder = 'branch-name';
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

  const preview = document.createElement('span');
  preview.className = 'preview';
  preview.style.backgroundColor = color;
  preview.textContent = isDefault ? 'other' : (name || 'branch');

  picker.addEventListener('input', () => {
    hex.value = picker.value;
    preview.style.backgroundColor = picker.value;
    swatchDisplay.style.backgroundColor = picker.value;
  });

  hex.addEventListener('change', () => {
    const val = hex.value.trim();
    if (!val.match(/^#[0-9A-Fa-f]{6}$/)) {
      showStatus('❌ Ungültige Farbe! Format: #RRGGBB', 'error');
      hex.value = picker.value;
      return;
    }
    picker.value = val;
    preview.style.backgroundColor = val;
    swatchDisplay.style.backgroundColor = val;
  });

  if (!isDefault) {
    nameEl.addEventListener('input', () => {
      preview.textContent = nameEl.value.trim() || 'branch';
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
    removeBtn.title = 'Branch entfernen';
    removeBtn.setAttribute('aria-label', `Branch "${name}" entfernen`);
    removeBtn.addEventListener('click', () => {
      const rowEls = [nameEl, swatchWrapper, hex, preview, removeBtn];
      const idx = Array.from(list.children).indexOf(nameEl);
      // Remove the row and an adjacent divider
      const prevDivider = list.children[idx - 1];
      if (prevDivider && prevDivider.classList.contains('row-divider')) {
        prevDivider.remove();
      }
      rowEls.forEach(el => el.remove());
      validateAllNameFields();
    });
  }

  return [nameEl, swatchWrapper, hex, preview, removeBtn];
}

function addBranchRow() {
  const addBtn = list.querySelector('.add-branch-btn');
  const color = NEW_BRANCH_PALETTE[paletteIndex % NEW_BRANCH_PALETTE.length];
  paletteIndex++;

  // Insert a divider + new row right before the default row's preceding divider...
  // Simpler: insert right before the add button.
  const dividerEl = divider();
  list.insertBefore(dividerEl, addBtn);
  buildRow('', color, false).forEach(el => list.insertBefore(el, addBtn));

  const newNameInput = dividerEl.nextSibling;
  if (newNameInput && newNameInput.focus) newNameInput.focus();

  validateAllNameFields();
}

function saveSettings() {
  const colors = {};
  const rows = Array.from(list.children).filter(
    el => !el.classList.contains('row-divider') && !el.classList.contains('add-branch-btn')
  );

  const seenNames = new Set();
  let hasError = false;

  for (let i = 0; i < rows.length; i += 5) {
    const nameEl = rows[i];
    const hexEl = rows[i + 2];
    const isDefault = nameEl.tagName === 'SPAN';
    const key = isDefault ? 'default' : nameEl.value.trim();

    if (!isDefault) {
      if (!key) { continue; }
      if (seenNames.has(key)) {
        showStatus(`❌ Branch "${key}" ist doppelt`, 'error');
        hasError = true;
        continue;
      }
      seenNames.add(key);
    }

    colors[key] = hexEl.value.trim();
  }

  if (hasError) return;

  const githubToken = tokenInput.value.trim();

  chrome.storage.local.set({ branchColors: colors, githubToken }, () => {
    showStatus('✓ Gespeichert!', 'success');
    renderRows(colors);

    chrome.tabs.query({ url: '*://github.com/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'reloadBadges' }).catch(() => {});
      });
    });
  });
}

function resetSettings() {
  chrome.storage.local.set({ branchColors: DEFAULT_COLORS }, () => {
    renderRows(DEFAULT_COLORS);
    showStatus('✓ Zurückgesetzt!', 'success');

    chrome.tabs.query({ url: '*://github.com/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'reloadBadges' }).catch(() => {});
      });
    });
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
