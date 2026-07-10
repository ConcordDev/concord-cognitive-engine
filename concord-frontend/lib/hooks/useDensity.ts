'use client';

// concord-frontend/lib/hooks/useDensity.ts
//
// Global "information density" preference — Low / Medium / High — for the
// design system's density tokens (`lib/design-system.ts` DENSITY_TOKENS).
// Persists to localStorage and mirrors the resolved multipliers onto
// `document.documentElement` as both a `data-density` attribute and the
// `--density-*` CSS custom properties, so any stylesheet can consume e.g.
// `padding: calc(var(--space-md) * var(--density-space, 1))` without a
// React re-render per consumer. Follows the same read-then-hydrate-in-effect
// pattern as `useDashboardPrefs.ts` (avoids SSR/client markup mismatch).

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_DENSITY,
  DENSITY_LEVELS,
  DENSITY_TOKENS,
  densityCssVars,
  type DensityLevel,
} from '@/lib/design-system';

const KEY = 'concord:density';

function isDensityLevel(v: unknown): v is DensityLevel {
  return v === 'low' || v === 'medium' || v === 'high';
}

function read(): DensityLevel {
  if (typeof window === 'undefined') return DEFAULT_DENSITY;
  try {
    const raw = window.localStorage.getItem(KEY);
    return isDensityLevel(raw) ? raw : DEFAULT_DENSITY;
  } catch {
    return DEFAULT_DENSITY;
  }
}

function applyToDocument(level: DensityLevel) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.density = level;
  const vars = densityCssVars(level);
  for (const [prop, value] of Object.entries(vars)) {
    root.style.setProperty(prop, value);
  }
}

/**
 * Global information-density preference (Low / Medium / High). Reads/writes
 * localStorage and mirrors the choice onto `document.documentElement` so
 * plain CSS can react without React in the loop.
 *
 * Usage:
 *   const { density, setDensity, tokens } = useDensity();
 *   <div style={{ padding: tokens.paddingPx, gap: tokens.gapPx }}>...</div>
 *
 * Or, for a scoped (non-global) density on a single subtree, skip this hook
 * and spread `densityStyle(level)` from `lib/design-system.ts` onto that
 * subtree's own `style` prop instead.
 */
export function useDensity() {
  const [density, setDensityState] = useState<DensityLevel>(DEFAULT_DENSITY);

  // Hydrate from localStorage after mount (avoids SSR mismatch), then apply.
  useEffect(() => {
    const initial = read();
    setDensityState(initial);
    applyToDocument(initial);
  }, []);

  const setDensity = useCallback((level: DensityLevel) => {
    setDensityState(level);
    applyToDocument(level);
    try {
      window.localStorage.setItem(KEY, level);
    } catch {
      /* quota / private mode — in-memory state still applies for this session */
    }
  }, []);

  const cycle = useCallback(() => {
    const next = DENSITY_LEVELS[(DENSITY_LEVELS.indexOf(density) + 1) % DENSITY_LEVELS.length];
    setDensity(next);
  }, [density, setDensity]);

  return {
    /** Current density level. */
    density,
    /** Set an explicit density level. */
    setDensity,
    /** Cycle low -> medium -> high -> low. */
    cycle,
    /** Resolved multiplier/px tokens for the current level. */
    tokens: DENSITY_TOKENS[density],
    /** All three levels' tokens, keyed by level (for building a picker UI). */
    allTokens: DENSITY_TOKENS,
    /** The three valid levels, in order. */
    levels: DENSITY_LEVELS,
  };
}
