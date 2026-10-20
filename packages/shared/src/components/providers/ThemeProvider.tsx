'use client';
import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} });
let memoryTheme: Theme | null = null;
const changeEvent = 'vivaai-theme-change';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem('vivaai_theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* Theme controls also work with browser storage disabled. */ }
  return memoryTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function subscribeTheme(notify: () => void) {
  const preference = window.matchMedia('(prefers-color-scheme: dark)');
  window.addEventListener('storage', notify);
  window.addEventListener(changeEvent, notify);
  preference.addEventListener('change', notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(changeEvent, notify);
    preference.removeEventListener('change', notify);
  };
}
const serverTheme = (): Theme => 'light';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);
  const toggle = () => {
    memoryTheme = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('vivaai_theme', memoryTheme); } catch { /* Use the in-memory preference. */ }
    window.dispatchEvent(new Event(changeEvent));
  };
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
