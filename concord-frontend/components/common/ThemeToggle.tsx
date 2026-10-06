'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';

type Theme = 'dark' | 'light' | 'system';
const THEME_KEY = 'concord_theme';

export function useThemeMode() {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY) as Theme | null;
      if (stored && ['dark', 'light', 'system'].includes(stored)) {
        setThemeState(stored);
        applyTheme(stored);
      }
    } catch {}
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem(THEME_KEY, t); } catch {}
    applyTheme(t);
  }, []);

  return { theme, setTheme };
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('light', !prefersDark);
  } else if (theme === 'light') {
    root.classList.add('light');
  } else {
    root.classList.remove('light');
  }
}

export function ThemeToggle() {
  const { theme, setTheme } = useThemeMode();

  const cycle = () => {
    const next: Theme = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
    setTheme(next);
  };

  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const label = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';

  return (
    <button
      onClick={cycle}
      className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
      title={`Theme: ${label}. Click to cycle.`}
      aria-label={`Switch theme. Currently ${label}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
