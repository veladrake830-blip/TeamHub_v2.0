export type Theme = 'SYSTEM' | 'LIGHT' | 'DARK';

const KEY = 'teamhub-theme';

/** The saved choice lives on the account. This copy only prevents a flash before it loads. */
export function applyTheme(theme: Theme) {
  if (theme === 'SYSTEM') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme.toLowerCase();
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage can be blocked. The account's setting still applies after loading.
  }
}

export function applyStoredTheme() {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'LIGHT' || stored === 'DARK') document.documentElement.dataset.theme = stored.toLowerCase();
  } catch {
    // See applyTheme.
  }
}
