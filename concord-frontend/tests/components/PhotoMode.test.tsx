/**
 * Concordia Phase 15 — PhotoMode tests.
 *
 * Pins:
 *   - hidden by default
 *   - concordia:photo-mode-toggle event shows + hides
 *   - 6 filter buttons render (none + 6 = 7) when active
 *   - filter click sets aria-pressed
 *   - Escape exits (restores filter to 'none')
 *   - dispatches concordia:time-dilation with scale=0.0001 on entry,
 *     1.0 on exit
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { PhotoMode, PHOTO_MODE_CONSTANTS } from '@/components/concordia/PhotoMode';

function dispatchToggle() {
  act(() => {
    window.dispatchEvent(new CustomEvent('concordia:photo-mode-toggle'));
  });
}

describe('PhotoMode — hidden by default', () => {
  it('renders nothing initially', () => {
    const { container } = render(<PhotoMode />);
    expect(container.querySelector('[data-testid="photo-mode-panel"]')).toBeNull();
  });
});

describe('PhotoMode — toggle event', () => {
  it('shows panel on toggle event', () => {
    const { container } = render(<PhotoMode />);
    dispatchToggle();
    expect(container.querySelector('[data-testid="photo-mode-panel"]')).not.toBeNull();
  });

  it('hides panel on second toggle', () => {
    const { container } = render(<PhotoMode />);
    dispatchToggle();
    dispatchToggle();
    expect(container.querySelector('[data-testid="photo-mode-panel"]')).toBeNull();
  });
});

describe('PhotoMode — filter buttons', () => {
  it('renders 7 filter buttons (none + 6 named)', () => {
    const { container } = render(<PhotoMode />);
    dispatchToggle();
    const buttons = container.querySelectorAll('button[data-filter]');
    expect(buttons.length).toBe(7);
  });

  it('clicking a filter sets aria-pressed', () => {
    const { container } = render(<PhotoMode />);
    dispatchToggle();
    const velvia = container.querySelector('button[data-filter="velvia"]')!;
    fireEvent.click(velvia);
    expect(velvia.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('PhotoMode — time dilation events', () => {
  let dilations: number[];
  let listener: (e: Event) => void;

  beforeEach(() => {
    dilations = [];
    listener = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.scale != null) dilations.push(d.scale);
    };
    window.addEventListener('concordia:time-dilation', listener);
  });

  afterEach(() => {
    window.removeEventListener('concordia:time-dilation', listener);
  });

  it('dispatches scale=0.0001 on entry, 1.0 on exit', () => {
    render(<PhotoMode />);
    dispatchToggle();
    expect(dilations.at(-1)).toBe(0.0001);
    dispatchToggle();
    expect(dilations.at(-1)).toBe(1.0);
  });
});

describe('PhotoMode — Escape exits', () => {
  it('Escape closes the panel', () => {
    const { container } = render(<PhotoMode />);
    dispatchToggle();
    expect(container.querySelector('[data-testid="photo-mode-panel"]')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('[data-testid="photo-mode-panel"]')).toBeNull();
  });
});

describe('PhotoMode — constants', () => {
  it('exposes 7 filters', () => {
    expect(Object.keys(PHOTO_MODE_CONSTANTS.FILTER_CSS).length).toBe(7);
  });
});
