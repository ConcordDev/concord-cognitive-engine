/**
 * World Lens plan Phase 6c — AccessibilityDOMApplier's real colorblind
 * correction. Before this fix, `globals.css` referenced SVG filter
 * elements (`url('#cb-protanopia')` etc.) that were never actually
 * rendered anywhere in the DOM (confirmed by grep — zero `feColorMatrix`
 * anywhere in the frontend), so selecting a colorblind mode in Settings
 * set the right `data-colorblind` attribute but visually corrected
 * nothing — a 100% inert no-op. Separately, high-contrast's own
 * `filter: contrast(1.15)` CSS rule could never coexist with the
 * colorblind rule (CSS `filter` doesn't stack across two independently
 * matching rules), so enabling both together silently dropped one.
 * Achromatopsia had no CSS/JS handling at all despite being offered in
 * the settings UI.
 *
 * This test drives the real `useUIStore` accessibility slice (the same
 * path the real settings page + event-router bridge use) and asserts the
 * actual applied `root.style.filter` and the real SVG defs exist.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import AccessibilityDOMApplier from '@/components/accessibility/AccessibilityDOMApplier';
import { useUIStore } from '@/store/ui';
import type { AccessibilitySettings } from '@/store/slices/accessibility';

function setA11y(overrides: Partial<AccessibilitySettings> = {}) {
  act(() => {
    useUIStore.getState().setAllAccessibility({
      colorblindMode: 'none',
      textScale: 1,
      screenReader: false,
      keyboardNavigation: false,
      reducedMotion: false,
      subtitles: false,
      subtitleFontSize: 16,
      gameSpeed: 1,
      highContrast: false,
      ...overrides,
    });
  });
}

describe('AccessibilityDOMApplier — real colorblind correction (Phase 6c)', () => {
  beforeEach(() => {
    const root = document.documentElement;
    delete root.dataset.colorblind;
    root.classList.remove('a11y-high-contrast', 'a11y-reduce-motion');
    root.style.fontSize = '';
    root.style.filter = '';
    useUIStore.getState().resetAccessibility?.();
  });

  it('renders the SVG filter defs the composed filter references', () => {
    const { container } = render(<AccessibilityDOMApplier />);
    expect(container.querySelector('filter#cb-protanopia')).toBeTruthy();
    expect(container.querySelector('filter#cb-deuteranopia')).toBeTruthy();
    expect(container.querySelector('filter#cb-tritanopia')).toBeTruthy();
    expect(container.querySelector('filter#cb-protanopia feColorMatrix')).toBeTruthy();
  });

  it('applies a real url() filter referencing the matching SVG def id for each dichromacy mode', () => {
    render(<AccessibilityDOMApplier />);
    setA11y({ colorblindMode: 'protanopia' });
    expect(document.documentElement.style.filter).toContain("url('#cb-protanopia')");
    setA11y({ colorblindMode: 'deuteranopia' });
    expect(document.documentElement.style.filter).toContain("url('#cb-deuteranopia')");
    setA11y({ colorblindMode: 'tritanopia' });
    expect(document.documentElement.style.filter).toContain("url('#cb-tritanopia')");
  });

  it('achromatopsia composes to a plain grayscale(1) — previously had zero handling anywhere', () => {
    render(<AccessibilityDOMApplier />);
    setA11y({ colorblindMode: 'achromatopsia' });
    expect(document.documentElement.style.filter).toContain('grayscale(1)');
  });

  it('high-contrast alone still applies contrast(1.15)', () => {
    render(<AccessibilityDOMApplier />);
    setA11y({ highContrast: true });
    expect(document.documentElement.style.filter).toContain('contrast(1.15)');
  });

  it('colorblind mode and high-contrast compose together instead of one silently winning the cascade', () => {
    render(<AccessibilityDOMApplier />);
    setA11y({ colorblindMode: 'deuteranopia', highContrast: true });
    const filter = document.documentElement.style.filter;
    expect(filter).toContain("url('#cb-deuteranopia')");
    expect(filter).toContain('contrast(1.15)');
  });

  it('clears the filter entirely when both are off', () => {
    render(<AccessibilityDOMApplier />);
    setA11y({ colorblindMode: 'protanopia', highContrast: true });
    expect(document.documentElement.style.filter).not.toBe('');
    setA11y({ colorblindMode: 'none', highContrast: false });
    expect(document.documentElement.style.filter).toBe('');
  });

  it('still sets data-colorblind as a general-purpose CSS hook (back-compat)', () => {
    render(<AccessibilityDOMApplier />);
    setA11y({ colorblindMode: 'tritanopia' });
    expect(document.documentElement.dataset.colorblind).toBe('tritanopia');
  });
});
