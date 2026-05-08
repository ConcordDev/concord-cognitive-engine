'use client';

/**
 * useAccessibilitySettings — read-only consumer of the global a11y store.
 *
 * Returns the merged effective settings: user choices from the store
 * folded with OS-level prefers-reduced-motion. The companion
 * useAccessibilityWatcher() registers the OS media-query listener and
 * should be mounted exactly once near the root.
 */

import { useEffect } from 'react';

import { useUIStore } from '@/store/ui';
import type { AccessibilitySettings } from '@/store/slices/accessibility';

export interface EffectiveAccessibility extends AccessibilitySettings {
  effectiveReducedMotion: boolean;
}

export function useAccessibilitySettings(): EffectiveAccessibility {
  const settings = useUIStore((s) => s.accessibility);
  const osReducedMotion = useUIStore((s) => s.osReducedMotion);
  return {
    ...settings,
    effectiveReducedMotion: settings.reducedMotion || osReducedMotion,
  };
}

export function useSetAccessibility() {
  const setAccessibility = useUIStore((s) => s.setAccessibility);
  const setAllAccessibility = useUIStore((s) => s.setAllAccessibility);
  const resetAccessibility = useUIStore((s) => s.resetAccessibility);
  return { setAccessibility, setAllAccessibility, resetAccessibility };
}

/**
 * Mount once near the app root (e.g. inside Providers). Subscribes to
 * the OS prefers-reduced-motion media query and writes the result into
 * the a11y store so every consumer reacts to OS preference changes.
 */
export function useAccessibilityWatcher() {
  const setOsReducedMotion = useUIStore((s) => s.setOsReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setOsReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setOsReducedMotion(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, [setOsReducedMotion]);
}
