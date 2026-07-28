import { i18nText } from '../shared/i18n.js';
import { uiLanguage, branchColors, discoveredBranches } from './state.js';
import { getSelectedBaseBranches, buildQueryForBaseBranches, navigateToQuery } from './query.js';
import { isPRListPage, resolveBranchColor } from './utils.js';

// Adds a "Base Branch ▾" dropdown before the Author button, offering a
// checkbox per known branch — mirrors GitHub's own "Filter by author"
// popover, but allows selecting several branches at once (OR-combined).
//
// Split into one builder/renderer per piece (button, popover shell, header,
// search, branch row) so each part can be read and changed in isolation;
// ensureBaseBranchFilterButton() below is just the orchestrator. All theming
// is done via CSS (see _variables.scss and CLAUDE.md's "Matching GitHub's
// Primer UI" section) — no JS theme detection here.

function buildFilterButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'base-branch-filter-button';
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');

  const buttonLabel = document.createElement('span');
  buttonLabel.textContent = i18nText(uiLanguage, 'filterButtonLabel');

  const buttonCount = document.createElement('span');
  buttonCount.className = 'base-branch-filter-count';

  // Same class GitHub's own "Author" button (right next to ours) uses for
  // its arrow — reusing it (rather than our own SVG/glyph) guarantees a
  // pixel-identical match via GitHub's already-loaded Primer CSS.
  const buttonArrow = document.createElement('span');
  buttonArrow.className = 'dropdown-caret hide-sm';

  button.appendChild(buttonLabel);
  button.appendChild(buttonCount);
  button.appendChild(buttonArrow);

  // Reflects the current selection right when the button is (re)created —
  // checkbox changes navigate to a new URL, so the button is rebuilt fresh
  // with the up-to-date count on the next load rather than updated in place.
  const selectedOnLoad = getSelectedBaseBranches();
  if (selectedOnLoad.length > 0) {
    buttonCount.textContent = String(selectedOnLoad.length);
    buttonCount.classList.add('base-branch-filter-count--visible');
    button.classList.add('base-branch-filter-button--active');
  }

  return button;
}

function buildFilterPopover() {
  const popover = document.createElement('div');
  popover.className = 'base-branch-filter-popover';
  return popover;
}

function buildFilterPopoverHeader(onClose) {
  const headerRow = document.createElement('div');
  headerRow.className = 'base-branch-filter-header';

  const title = document.createElement('span');
  title.className = 'base-branch-filter-title';
  title.textContent = i18nText(uiLanguage, 'filterPopoverTitle');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'base-branch-filter-close';
  // GitHub's own SelectMenu close button uses the "x" Octicon (16x16), not a
  // text glyph — a Unicode "✕" renders with a different weight/position
  // depending on the OS font, so we match the actual icon instead.
  closeBtn.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path></svg>';
  closeBtn.setAttribute('aria-label', i18nText(uiLanguage, 'closeAriaLabel'));
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClose();
  });

  headerRow.appendChild(title);
  headerRow.appendChild(closeBtn);
  return headerRow;
}

function buildBranchSearchInput(listContainer) {
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'base-branch-filter-search';
  searchInput.placeholder = i18nText(uiLanguage, 'filterBranchesPlaceholder');
  searchInput.addEventListener('input', () => {
    const term = searchInput.value.trim().toLowerCase();
    listContainer.querySelectorAll('label').forEach((row) => {
      row.style.display = row.dataset.branchName.includes(term) ? 'flex' : 'none';
    });
  });
  return searchInput;
}

function buildBranchRow(branch, selected) {
  const row = document.createElement('label');
  row.className = 'base-branch-filter-row';
  row.dataset.branchName = branch.toLowerCase();

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'base-branch-filter-checkbox';
  checkbox.checked = selected.has(branch);

  const dot = document.createElement('span');
  dot.className = 'base-branch-filter-dot';
  // Per-branch color, genuinely different per row — not theme-derived, so
  // it can't be hoisted to the wrapper like the other custom properties.
  dot.style.backgroundColor = resolveBranchColor(branchColors, branch);

  const label = document.createElement('span');
  label.className = 'base-branch-filter-label';
  label.textContent = branch;

  checkbox.addEventListener('change', () => {
    const current = new Set(getSelectedBaseBranches());
    if (checkbox.checked) current.add(branch);
    else current.delete(branch);
    navigateToQuery(buildQueryForBaseBranches(Array.from(current)));
  });

  // Space toggles a focused checkbox natively; Enter doesn't (there's no
  // <form> here to submit) — GitHub's own SelectMenu items respond to both,
  // so match that instead of only supporting Space.
  checkbox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      checkbox.click();
    }
  });

  row.appendChild(checkbox);
  row.appendChild(dot);
  row.appendChild(label);
  return row;
}

// Only rows currently visible under the search filter are valid stops —
// `display: none` rows (see buildBranchSearchInput) must be skipped so arrow
// navigation doesn't get stuck moving focus onto a hidden checkbox.
function visibleBranchRows(listContainer) {
  return Array.from(listContainer.querySelectorAll('.base-branch-filter-row')).filter(
    (row) => row.style.display !== 'none'
  );
}

// Arrow-key navigation between branch checkboxes, matching GitHub's own
// SelectMenu (which supports moving through the list without a mouse).
function wireBranchListKeyboardNav(searchInput, listContainer) {
  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown') return;
    const rows = visibleBranchRows(listContainer);
    if (rows.length === 0) return;
    e.preventDefault();
    rows[0].querySelector('.base-branch-filter-checkbox').focus();
  });

  listContainer.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = visibleBranchRows(listContainer);
    const currentRow = e.target.closest('.base-branch-filter-row');
    const currentIndex = rows.indexOf(currentRow);
    if (currentIndex === -1) return;
    e.preventDefault();

    if (e.key === 'ArrowUp' && currentIndex === 0) {
      searchInput.focus();
      return;
    }

    const nextIndex = e.key === 'ArrowDown' ? currentIndex + 1 : currentIndex - 1;
    const nextRow = rows[nextIndex];
    if (nextRow) nextRow.querySelector('.base-branch-filter-checkbox').focus();
  });
}

function renderFilterPopoverContent(popover, onClose) {
  popover.innerHTML = '';
  popover.appendChild(buildFilterPopoverHeader(onClose));

  const allBranches = Array.from(
    new Set([...Object.keys(branchColors).filter((k) => k !== 'default'), ...discoveredBranches])
  ).sort();

  if (allBranches.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'base-branch-filter-empty';
    empty.textContent = i18nText(uiLanguage, 'noBranchesDiscovered');
    popover.appendChild(empty);
    return;
  }

  const listContainer = document.createElement('div');
  listContainer.className = 'base-branch-filter-list';

  const searchInput = buildBranchSearchInput(listContainer);
  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'base-branch-filter-search-wrapper';
  searchWrapper.appendChild(searchInput);
  popover.appendChild(searchWrapper);
  popover.appendChild(listContainer);
  wireBranchListKeyboardNav(searchInput, listContainer);

  const selected = new Set(getSelectedBaseBranches());
  allBranches.forEach((branch) => {
    listContainer.appendChild(buildBranchRow(branch, selected));
  });
}

// Wires the button click → open/close + render-on-open behavior. Popover
// content is (re)rendered fresh on every open rather than kept in sync
// incrementally, since it only reflects cheap-to-recompute state (discovered
// branches, current URL selection).
function wireFilterDropdownToggle(button, popover, closePopover) {
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = popover.style.display !== 'flex';
    document.querySelectorAll('.base-branch-filter-popover').forEach((p) => {
      p.style.display = 'none';
    });
    if (willOpen) {
      renderFilterPopoverContent(popover, closePopover);
      popover.style.display = 'flex';
      // Popover content is rebuilt fresh on every open, so the search input
      // needs to be re-focused each time too — a keyboard user reaching
      // this button expects to land somewhere useful, not nowhere.
      const searchInput = popover.querySelector('.base-branch-filter-search');
      if (searchInput) searchInput.focus();
    }
    button.setAttribute('aria-expanded', String(willOpen));
  });
}

function wireFilterDropdownDismissal(wrapper, closePopover) {
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      closePopover();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
  });
}

export function ensureBaseBranchFilterButton() {
  if (!isPRListPage()) return;

  const authorButton = document.querySelector('#author-select-menu');
  if (!authorButton) return;

  const filterHeader = authorButton.parentElement;
  if (!filterHeader) return;

  if (filterHeader.querySelector('.base-branch-filter-btn')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'base-branch-filter-btn';

  const button = buildFilterButton();
  const popover = buildFilterPopover();

  function closePopover() {
    popover.style.display = 'none';
    button.setAttribute('aria-expanded', 'false');
  }

  wireFilterDropdownToggle(button, popover, closePopover);
  wireFilterDropdownDismissal(wrapper, closePopover);

  wrapper.appendChild(button);
  wrapper.appendChild(popover);
  filterHeader.insertBefore(wrapper, authorButton);
}

export function refreshFilterUI() {
  ensureBaseBranchFilterButton();
}
