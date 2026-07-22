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
