'use client';

/**
 * usePowerMode — Simple/Power mode toggle.
 *
 * Simple mode (default): Clean interface, hides technical UI.
 * Power mode: Shows DTU counter, brain status, activity timeline, etc.
 *
 * Stored in localStorage. Toggle via settings or long-press logo.
 */

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'concord-power-mode';

export function usePowerMode() {
  const [powerMode, setPowerMode] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'true') setPowerMode(true);
    } catch {
      // localStorage may not be available
    }
    setLoaded(true);
  }, []);

  // Persist to localStorage on change
  const togglePowerMode = useCallback(() => {
    setPowerMode(prev => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // best-effort
      }
      return next;
    });
  }, []);

  const setPowerModeValue = useCallback((value: boolean) => {
    setPowerMode(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // best-effort
    }
  }, []);

  return {
    powerMode,
    togglePowerMode,
    setPowerMode: setPowerModeValue,
    loaded,
  };
}
