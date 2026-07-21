'use client';

/**
 * AccessibilityDOMApplier — G3.1 fix, extended by World Lens Phase 6c.
 *
 * The accessibility settings store was wired to NOTHING: colorblind mode,
 * text-scale, and high-contrast had zero DOM application, and reduced-motion
 * never reached the world. This component reads the (now-bridged) store and
 * applies the visual settings to <html> + exposes reduced-motion as a class
 * + a window flag the 3D world / juice layers gate on.
 *
 * Phase 6c fixed a second layer of the same "looks wired, does nothing" bug
 * class: colorblind correction was setting `data-colorblind` correctly, but
 * the CSS rules that used to reference it (`filter: url('#cb-protanopia')`)
 * pointed at SVG `<filter>` elements that were never actually rendered
 * anywhere — confirmed by grep, zero `feColorMatrix` in the whole frontend
 * before this fix — so selecting a colorblind mode was a 100% inert no-op.
 * Separately, high-contrast's OWN `filter: contrast(1.15)` CSS rule could
 * never coexist with the colorblind rule (CSS `filter` doesn't stack across
 * two independent matching rules — cascade order picks exactly one). Both
 * are fixed together: this component now renders the real SVG filter defs
 * AND composes both concerns into one `root.style.filter` string in its own
 * effect, so there is no cascade race to lose.
 *
 * Mount once in Providers. Reactive — re-applies whenever the store changes.
 *
 * CSS hooks (consumed in globals.css):
 *   html.a11y-high-contrast :focus-visible { outline boost }
 *   html.a11y-reduce-motion *, [data-reduce-motion] { animation/transition off }
 *   --a11y-text-scale: <n>  (root font-size multiplier)
 * DOM/JS hooks (applied directly by this component, not CSS selectors):
 *   root.style.filter — composed colorblind matrix/grayscale + contrast boost
 *   #a11y-cb-filters — the SVG <filter> defs the composed filter references
 */

import { useEffect } from 'react';
import { useAccessibilitySettings, useAccessibilityWatcher } from '@/hooks/useAccessibilitySettings';
import type { ColorblindMode } from '@/store/slices/accessibility';

/**
 * Brettel/Viénot-derived dichromacy approximation matrices — the same
 * values widely reused across web colorblindness simulators. Achromatopsia
 * (full color blindness) needs no matrix; a plain `grayscale(1)` covers it
 * exactly and was simpler + more literally correct than approximating it
 * with a 5th SVG feColorMatrix.
 */
const COLORBLIND_FILTER_FN: Partial<Record<ColorblindMode, string>> = {
  protanopia: "url('#cb-protanopia')",
  deuteranopia: "url('#cb-deuteranopia')",
  tritanopia: "url('#cb-tritanopia')",
  achromatopsia: 'grayscale(1)',
};

export default function AccessibilityDOMApplier() {
  // Keep the OS prefers-reduced-motion watcher live so effectiveReducedMotion
  // folds the OS preference in.
  useAccessibilityWatcher();
  const a11y = useAccessibilitySettings();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    // 1) Colorblind mode → data-attr (kept as a general-purpose CSS hook
    // for anything else that wants to key off it) + the real correction.
    if (a11y.colorblindMode && a11y.colorblindMode !== 'none') {
      root.dataset.colorblind = a11y.colorblindMode;
    } else {
      delete root.dataset.colorblind;
    }

    // 2) Text scale → CSS var + root font-size (clamped sane).
    const scale = Math.max(0.8, Math.min(2.0, Number(a11y.textScale) || 1));
    root.style.setProperty('--a11y-text-scale', String(scale));
    root.style.fontSize = `${Math.round(16 * scale)}px`;

    // 3) High contrast → class (kept for the :focus-visible CSS hook) +
    // folded into the composed filter below.
    root.classList.toggle('a11y-high-contrast', !!a11y.highContrast);

    // Compose colorblind correction + contrast boost into ONE filter
    // string — see the file doc comment for why this can't be left to
    // CSS cascade across two separate rules.
    const filterParts: string[] = [];
    const cbFn = COLORBLIND_FILTER_FN[a11y.colorblindMode];
    if (cbFn) filterParts.push(cbFn);
    if (a11y.highContrast) filterParts.push('contrast(1.15)');
    root.style.filter = filterParts.length ? filterParts.join(' ') : '';

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

  // Invisible SVG filter defs the composed `root.style.filter` above
  // references by id. Zero-size + absolutely positioned so it never
  // affects layout; `aria-hidden` since it has no accessible content.
  return (
    <svg
      id="a11y-cb-filters"
      aria-hidden="true"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <defs>
        <filter id="cb-protanopia" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0.567 0.433 0.000 0 0
                    0.558 0.442 0.000 0 0
                    0.000 0.242 0.758 0 0
                    0.000 0.000 0.000 1 0"
          />
        </filter>
        <filter id="cb-deuteranopia" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0.625 0.375 0.000 0 0
                    0.700 0.300 0.000 0 0
                    0.000 0.300 0.700 0 0
                    0.000 0.000 0.000 1 0"
          />
        </filter>
        <filter id="cb-tritanopia" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0.950 0.050 0.000 0 0
                    0.000 0.433 0.567 0 0
                    0.000 0.475 0.525 0 0
                    0.000 0.000 0.000 1 0"
          />
        </filter>
      </defs>
    </svg>
  );
}
