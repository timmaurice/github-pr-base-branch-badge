import { i18nText } from '../shared/i18n.js';
import { uiLanguage, branchColors, discoveredBranches } from './state.js';
import { getSelectedBaseBranches, buildQueryForBaseBranches, navigateToQuery } from './query.js';
import { isPRListPage, isDarkMode, resolveBranchColor } from './utils.js';

// Adds a "Base Branch ▾" dropdown before the Author button, offering a
// checkbox per known branch — mirrors GitHub's own "Filter by author"
// popover, but allows selecting several branches at once (OR-combined).
//
// Split into one builder/renderer per piece (button, popover shell, header,
// search, branch row) so each part can be read and changed in isolation;
// ensureBaseBranchFilterButton() below is just the orchestrator.
//
// Theme colors are set once, as CSS custom properties on the wrapper (see
// ensureBaseBranchFilterButton), and inherited by every descendant class in
// styles.css — none of the builders below touch colors directly, which is
// also what lets :hover/:focus-visible work at all (a style.cssText block
// on each element used to shadow the stylesheet, including its
// pseudo-classes, forcing mouseenter/mouseleave/focus/blur listeners to
// fake what CSS already does).

function getFilterPopoverColors(dark) {
  return dark
    ? {
        bg: '#1c2128',
        border: '#30363d',
        divider: '#30363d',
        text: '#e6edf3',
        muted: '#7d8590',
        hover: 'rgba(177, 186, 196, 0.12)',
        inputBg: '#0d1117',
        inputBorder: '#30363d',
        focusRing: '#1f6feb'
      }
    : {
        bg: '#ffffff',
        border: '#d0d7de',
        divider: '#d8dee4',
        text: '#1f2328',
        muted: '#59636e',
        hover: 'rgba(208, 215, 222, 0.32)',
        inputBg: '#ffffff',
        inputBorder: '#d0d7de',
        focusRing: '#0969da'
      };
}

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
  closeBtn.textContent = '✕';
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

  row.appendChild(checkbox);
  row.appendChild(dot);
  row.appendChild(label);
  return row;
}

function renderFilterPopoverContent(popover, onClose) {
  popover.innerHTML = '';
  popover.appendChild(buildFilterPopoverHeader(onClose));

  const divider = document.createElement('div');
  divider.className = 'base-branch-filter-divider';
  popover.appendChild(divider);

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

  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'base-branch-filter-search-wrapper';
  searchWrapper.appendChild(buildBranchSearchInput(listContainer));
  popover.appendChild(searchWrapper);
  popover.appendChild(listContainer);

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

  const colors = getFilterPopoverColors(isDarkMode());

  const wrapper = document.createElement('div');
  wrapper.className = 'base-branch-filter-btn';
  wrapper.style.setProperty('--fb-text', colors.text);
  wrapper.style.setProperty('--fb-hover', colors.hover);
  wrapper.style.setProperty('--fb-bg', colors.bg);
  wrapper.style.setProperty('--fb-border', colors.border);
  wrapper.style.setProperty('--fb-divider', colors.divider);
  wrapper.style.setProperty('--fb-muted', colors.muted);
  wrapper.style.setProperty('--fb-input-bg', colors.inputBg);
  wrapper.style.setProperty('--fb-input-border', colors.inputBorder);
  wrapper.style.setProperty('--fb-focus-ring', colors.focusRing);
  wrapper.style.setProperty('--fb-focus-ring-alpha', `${colors.focusRing}33`);

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
