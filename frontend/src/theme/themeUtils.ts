export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'zaalima_theme_preference'

export function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') {
      return stored
    }
  } catch {
    // Gracefully handle environments without localStorage or window access
  }
  return 'light'
}
