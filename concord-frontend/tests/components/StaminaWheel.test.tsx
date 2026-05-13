/**
 * Concordia Phase 5 — StaminaWheel presentational tests.
 *
 * Pins:
 *   - Hidden when state=rest AND full
 *   - Visible when state=rest AND below full
 *   - Renders each non-rest state with its glyph
 *   - data-state attribute reflects state
 *   - ARIA label includes percent + state label
 *   - Defaults to max=100 when undefined
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StaminaWheel } from '@/components/concordia/StaminaWheel';

function wheel(c: HTMLElement): HTMLElement | null {
  return c.querySelector('[data-testid="stamina-wheel"]');
}

describe('StaminaWheel — visibility', () => {
  it('hidden when rest + full', () => {
    const { container } = render(<StaminaWheel value={100} max={100} state="rest" />);
    expect(wheel(container)).toBeNull();
  });

  it('visible when rest + below full', () => {
    const { container } = render(<StaminaWheel value={50} max={100} state="rest" />);
    expect(wheel(container)).not.toBeNull();
  });

  it('visible during climbing', () => {
    const { container } = render(<StaminaWheel value={80} max={100} state="climbing" />);
    expect(wheel(container)?.getAttribute('data-state')).toBe('climbing');
  });

  it('visible when exhausted at zero', () => {
    const { container } = render(<StaminaWheel value={0} max={100} state="exhausted" />);
    expect(wheel(container)?.getAttribute('data-state')).toBe('exhausted');
  });
});

describe('StaminaWheel — ARIA', () => {
  it('aria-label includes percent + state', () => {
    const { container } = render(<StaminaWheel value={60} max={100} state="climbing" />);
    const label = wheel(container)?.getAttribute('aria-label') || '';
    expect(label).toMatch(/60/);
    expect(label).toMatch(/climbing/);
  });

  it('role=tooltip', () => {
    const { container } = render(<StaminaWheel value={50} state="sprinting" />);
    expect(wheel(container)?.getAttribute('role')).toBe('tooltip');
  });
});

describe('StaminaWheel — defaults', () => {
  it('defaults to max=100 when undefined', () => {
    const { container } = render(<StaminaWheel value={50} state="climbing" />);
    const label = wheel(container)?.getAttribute('aria-label') || '';
    expect(label).toMatch(/50/);
  });

  it('clamps value to [0, max]', () => {
    const { container } = render(<StaminaWheel value={200} max={100} state="climbing" />);
    const label = wheel(container)?.getAttribute('aria-label') || '';
    expect(label).toMatch(/100/);
  });

  it('clamps negative value to 0', () => {
    const { container } = render(<StaminaWheel value={-10} max={100} state="climbing" />);
    const label = wheel(container)?.getAttribute('aria-label') || '';
    expect(label).toMatch(/\b0\b/);
  });
});
