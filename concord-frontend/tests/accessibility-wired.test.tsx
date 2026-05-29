// G3.1 — accessibility settings now apply to the DOM + world.
//
// Pins the fix for "options apply to NOTHING": the a11y store is bridged from
// the settings event, and AccessibilityDOMApplier writes colorblind / text-scale
// / high-contrast / reduced-motion to <html> + a window flag.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AccessibilityDOMApplier from '@/components/accessibility/AccessibilityDOMApplier';
import { useUIStore } from '@/store/ui';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('G3.1 — DOM applier writes a11y settings to <html>', () => {
  beforeEach(() => {
    // reset the html element + store between tests
    const root = document.documentElement;
    delete root.dataset.colorblind;
    root.classList.remove('a11y-high-contrast', 'a11y-reduce-motion');
    root.style.fontSize = '';
    useUIStore.getState().resetAccessibility?.();
  });

  it('applies colorblind, text-scale, high-contrast, reduced-motion', () => {
    act(() => {
      useUIStore.getState().setAllAccessibility({
        colorblindMode: 'protanopia',
        textScale: 1.5,
        screenReader: false,
        keyboardNavigation: false,
        reducedMotion: true,
        subtitles: false,
        subtitleFontSize: 16,
        gameSpeed: 1,
        highContrast: true,
      });
    });
    render(<AccessibilityDOMApplier />);
    const root = document.documentElement;
    expect(root.dataset.colorblind).toBe('protanopia');
    expect(root.classList.contains('a11y-high-contrast')).toBe(true);
    expect(root.classList.contains('a11y-reduce-motion')).toBe(true);
    expect(root.style.fontSize).toBe('24px'); // 16 × 1.5
    expect((window as unknown as { __CONCORD_REDUCE_MOTION__?: boolean }).__CONCORD_REDUCE_MOTION__).toBe(true);
  });

  it('clears colorblind + classes when settings are default/off', () => {
    act(() => {
      useUIStore.getState().setAllAccessibility({
        colorblindMode: 'none', textScale: 1, screenReader: false, keyboardNavigation: false,
        reducedMotion: false, subtitles: false, subtitleFontSize: 16, gameSpeed: 1, highContrast: false,
      });
    });
    render(<AccessibilityDOMApplier />);
    const root = document.documentElement;
    expect(root.dataset.colorblind).toBeUndefined();
    expect(root.classList.contains('a11y-high-contrast')).toBe(false);
    expect(root.classList.contains('a11y-reduce-motion')).toBe(false);
  });
});

describe('G3.1 — store bridge + mounts are wired', () => {
  it('event-router writes the store on concord:a11y-changed (not just a toast)', () => {
    const src = readFileSync(path.resolve(__dirname, '..', 'lib/event-router.ts'), 'utf8');
    expect(src).toMatch(/'concord:a11y-changed'/);
    expect(src).toMatch(/setAllAccessibility/);
  });
  it('AccessibilityDOMApplier is mounted in Providers', () => {
    const src = readFileSync(path.resolve(__dirname, '..', 'components/Providers.tsx'), 'utf8');
    expect(src).toMatch(/<AccessibilityDOMApplier \/>/);
  });
  it('GameJuice gates motion on reduced-motion', () => {
    const src = readFileSync(path.resolve(__dirname, '..', 'components/world-lens/GameJuice.tsx'), 'utf8');
    expect(src).toMatch(/effectiveReducedMotion/);
  });
});
