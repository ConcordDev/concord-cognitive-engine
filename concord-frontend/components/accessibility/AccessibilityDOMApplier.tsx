'use client';

/**
 * AccessibilityDOMApplier — G3.1 fix.
 *
 * The accessibility settings store was wired to NOTHING: colorblind mode,
 * text-scale, and high-contrast had zero DOM application, and reduced-motion
 * never reached the world. This component reads the (now-bridged) store and
 * applies the three visual settings to <html> + exposes reduced-motion as a
 * class + a window flag the 3D world / juice layers gate on.
 *
 * Mount once in Providers. Reactive — re-applies whenever the store changes.
 *
 * CSS hooks (consumed in globals.css):
 *   html[data-colorblind="protanopia|deuteranopia|tritanopia"] { filter: url(...) }
 *   html.a11y-high-contrast { ... }
 *   html.a11y-reduce-motion *, [data-reduce-motion] { animation/transition off }
 *   --a11y-text-scale: <n>  (root font-size multiplier)
 */

import { useEffect } from 'react';
import { useAccessibilitySettings, useAccessibilityWatcher } from '@/hooks/useAccessibilitySettings';

export default function AccessibilityDOMApplier() {
  // Keep the OS prefers-reduced-motion watcher live so effectiveReducedMotion
  // folds the OS preference in.
  useAccessibilityWatcher();
  const a11y = useAccessibilitySettings();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    // 1) Colorblind mode → data-attr (CSS applies the SVG filter).
    if (a11y.colorblindMode && a11y.colorblindMode !== 'none') {
      root.dataset.colorblind = a11y.colorblindMode;
    } else {
      delete root.dataset.colorblind;
    }

    // 2) Text scale → CSS var + root font-size (clamped sane).
    const scale = Math.max(0.8, Math.min(2.0, Number(a11y.textScale) || 1));
    root.style.setProperty('--a11y-text-scale', String(scale));
    root.style.fontSize = `${Math.round(16 * scale)}px`;

    // 3) High contrast → class.
    root.classList.toggle('a11y-high-contrast', !!a11y.highContrast);

    // 4) Reduced motion → class + window flag. The class drives CSS
    // animation/transition suppression; the flag is the imperative read-API for
    // any non-React Three.js loop. GameJuice reads reduced-motion directly from
    // the accessibility store (shake/knockback suppression). The former
    // `concordia:reduce-motion` dispatch had no listener and was redundant with
    // both of those paths, so it was removed.
    const reduce = !!a11y.effectiveReducedMotion;
    root.classList.toggle('a11y-reduce-motion', reduce);
    (window as unknown as { __CONCORD_REDUCE_MOTION__?: boolean }).__CONCORD_REDUCE_MOTION__ = reduce;
  }, [a11y.colorblindMode, a11y.textScale, a11y.highContrast, a11y.effectiveReducedMotion]);

  return null;
}
