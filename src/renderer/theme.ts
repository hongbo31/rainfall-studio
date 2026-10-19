export type Theme = 'original' | 'white';
export const themePreferenceKey = 'rainfall.ui.theme.v1';
const changed = 'rainfall-theme-changed';
export function initializeTheme(): Theme {
  let value: string | null = null;
  try { value = localStorage.getItem(themePreferenceKey); } catch { /* Default remains usable. */ }
  const theme: Theme = value === 'white' ? 'white' : 'original';
  document.documentElement.dataset.theme = theme;
  return theme;
}
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'white' ? 'white' : 'original';
}
export function setTheme(theme: Theme): boolean {
  document.documentElement.dataset.theme = theme;
  let saved = false;
  try { localStorage.setItem(themePreferenceKey, theme); saved = true; } catch { /* Report persistence failure. */ }
  window.dispatchEvent(new Event(changed));
  return saved;
}
export function subscribeTheme(listener: () => void) {
  window.addEventListener(changed, listener);
  const storage = (event: StorageEvent) => { if (event.key === themePreferenceKey) { initializeTheme(); listener(); } };
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(changed, listener); window.removeEventListener('storage', storage); };
}
